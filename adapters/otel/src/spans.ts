import { createHash, randomBytes } from 'node:crypto';
import type { NaroEvent } from '@naro/core';
import type { EventExporter } from '@naro/observability';

/**
 * OTLP/HTTP span export — ADR 0021: the second, additive export mode
 * alongside OtlpExporter's log records. Implements the OpenTelemetry
 * GenAI semantic conventions at their current (pre-1.0, experimental)
 * draft: agent spans, execute_tool action spans, gen_ai.* attributes.
 *
 *   agent span   one per runId, goal.started → terminal event
 *   action span  one per action.id, action.requested → action.completed;
 *                action.denied ends it immediately with an error status —
 *                its duration is gate latency, not execution time
 *   span events  reasoning iterations, model.usage, verification results
 *                fold into the parent agent span (no third span level in v1)
 *   trace        NaroEvent.traceId (fallback runId) hashed to the OTLP
 *                trace_id — delegated child runs share the trace and nest
 *                under the parent's open `delegate` action span when the
 *                pairing is identifiable from the stream.
 */

type OtlpValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };

function attr(key: string, value: unknown): { key: string; value: OtlpValue } {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number' && Number.isInteger(value)) return { key, value: { intValue: String(value) } };
  if (typeof value === 'number') return { key, value: { doubleValue: value } };
  return { key, value: { stringValue: typeof value === 'string' ? value : JSON.stringify(value) } };
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: { key: string; value: OtlpValue }[];
  events: { timeUnixNano: string; name: string; attributes: { key: string; value: OtlpValue }[] }[];
  status: { code: number; message?: string };
}

interface OpenSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startNanos: number;
  attributes: { key: string; value: OtlpValue }[];
  events: { timeUnixNano: string; name: string; attributes: { key: string; value: OtlpValue }[] }[];
  status: { code: number; message?: string };
}

const SPAN_KIND_INTERNAL = 1;
const STATUS_UNSET = 0;
const STATUS_OK = 1;
const STATUS_ERROR = 2;

const TERMINAL = new Set(['agent.completed', 'agent.failed', 'agent.cancelled', 'agent.paused']);

export interface OtlpSpanExporterOptions {
  /** Collector base URL, e.g. 'http://localhost:4318' — spans POST to /v1/traces. */
  readonly endpoint: string;
  readonly serviceName?: string;
  readonly headers?: Record<string, string>;
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
}

function nanos(at: number): number {
  return at * 1_000_000;
}

/** tool/env target minus scheme — the name an operator recognizes. */
function targetName(target: string): string {
  return target.replace(/^[a-z]+:\/\//i, '').replace(/\//g, '.');
}

export class OtlpSpanExporter implements EventExporter {
  private readonly opts: Required<Pick<OtlpSpanExporterOptions, 'serviceName'>> & OtlpSpanExporterOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly agents = new Map<string, OpenSpan>();   // runId → open agent span
  private readonly actions = new Map<string, OpenSpan>();  // action.id → open action span
  private readonly traceIds = new Map<string, string>();   // naro traceId → otlp trace_id
  private pending: Promise<void> = Promise.resolve();
  private writeError: unknown;

  constructor(opts: OtlpSpanExporterOptions) {
    this.opts = { serviceName: 'naro', ...opts };
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private traceId(e: NaroEvent): string {
    const key = e.traceId ?? e.runId;
    let id = this.traceIds.get(key);
    if (id === undefined) {
      id = createHash('sha256').update(key).digest('hex').slice(0, 32);
      this.traceIds.set(key, id);
    }
    return id;
  }

  private open(e: NaroEvent, name: string, attributes: ReturnType<typeof attr>[], parentSpanId?: string): OpenSpan {
    return {
      traceId: this.traceId(e), spanId: randomBytes(8).toString('hex'),
      ...(parentSpanId !== undefined && { parentSpanId }),
      name, startNanos: nanos(e.at), attributes, events: [],
      status: { code: STATUS_UNSET },
    };
  }

  private spanEvent(span: OpenSpan | undefined, e: NaroEvent, name: string, attrs: ReturnType<typeof attr>[] = []): void {
    span?.events.push({ timeUnixNano: String(nanos(e.at)), name, attributes: attrs });
  }

  /**
   * A delegated child's agent span nests under the parent's still-open
   * `delegate` action span when the pairing is identifiable — the action's
   * input names the child agent. If no such span is open (e.g. the parent
   * ran on another process), the span joins the shared trace as a root —
   * correlated by trace_id, not fabricated.
   */
  private parentFor(e: NaroEvent): string | undefined {
    for (const [id, span] of this.actions) {
      if (span.traceId !== this.traceId(e)) continue;
      const target = span.attributes.find((a) => a.key === 'naro.action.targetAgent');
      if (target && 'stringValue' in target.value && target.value.stringValue === e.agentId) return span.spanId;
    }
    return undefined;
  }

  private handle(e: NaroEvent, done: OtlpSpan[]): void {
    const agent = this.agents.get(e.runId);

    switch (e.type) {
      case 'agent.created':
      case 'goal.started': {
        if (agent === undefined) {
          const attrs = [
            attr('gen_ai.operation.name', 'invoke_agent'),
            attr('gen_ai.agent.name', e.agentId),
            attr('naro.runId', e.runId),
            attr('naro.goalId', e.goalId),
          ];
          if (e.type === 'goal.started') attrs.push(attr('gen_ai.agent.description', e.data.goal.description));
          this.agents.set(e.runId, this.open(e, `invoke_agent ${e.agentId}`, attrs, this.parentFor(e)));
        }
        return;
      }
      case 'action.requested': {
        const a = e.data.action;
        const input = a.input as { agent?: string } | undefined;
        const attrs = [
          attr('gen_ai.operation.name', 'execute_tool'),
          attr('gen_ai.tool.name', targetName(a.target)),
          attr('naro.capability', a.capability),
          attr('naro.action.id', a.id),
          ...(input?.agent !== undefined ? [attr('naro.action.targetAgent', input.agent)] : []),
        ];
        const parent = this.agents.get(e.runId);
        this.actions.set(a.id, this.open(e, `execute_tool ${targetName(a.target)}`, attrs, parent?.spanId));
        return;
      }
      case 'permission.requested': {
        const span = this.actions.get(e.data.action.id);
        if (e.data.policy !== undefined) span?.attributes.push(attr('naro.policy.engine', e.data.policy));
        return;
      }
      case 'action.permitted': {
        this.spanEvent(this.actions.get(e.data.action.id), e, 'permitted');
        return;
      }
      case 'action.denied': {
        // Denied ends the span immediately — duration is gate latency only.
        const span = this.actions.get(e.data.action.id);
        if (span !== undefined) {
          span.status = { code: STATUS_ERROR, ...(e.data.reason !== undefined && { message: e.data.reason }) };
          span.attributes.push(attr('naro.policy.verdict', 'denied'));
          this.close(span, e, done);
          this.actions.delete(e.data.action.id);
        }
        return;
      }
      case 'action.completed': {
        const span = this.actions.get(e.data.action.id);
        if (span !== undefined) {
          const ok = e.data.observation.success;
          span.attributes.push(attr('gen_ai.tool.call.result', ok ? 'success' : 'error'));
          if (!ok) span.status = { code: STATUS_ERROR, ...(e.data.observation.error !== undefined && { message: e.data.observation.error }) };
          else span.status = { code: STATUS_OK };
          this.close(span, e, done);
          this.actions.delete(e.data.action.id);
        }
        return;
      }
      case 'verification.completed': {
        this.spanEvent(agent, e, 'verification.completed', [
          attr('naro.verification.ok', e.data.ok),
          ...(e.data.reason !== undefined ? [attr('naro.verification.reason', e.data.reason)] : []),
        ]);
        return;
      }
      case 'reasoning.started': {
        this.spanEvent(agent, e, 'reasoning.iteration', [attr('naro.iteration', e.data.iteration)]);
        return;
      }
      case 'model.usage': {
        const u = e.data.usage;
        this.spanEvent(agent, e, 'model.usage', [
          ...(u.inputTokens !== undefined ? [attr('gen_ai.usage.input_tokens', u.inputTokens)] : []),
          ...(u.outputTokens !== undefined ? [attr('gen_ai.usage.output_tokens', u.outputTokens)] : []),
        ]);
        return;
      }
      case 'human.approval.requested':
      case 'human.approval.received':
      case 'replan.triggered':
      case 'checkpoint.created':
      case 'session.compacted':
      case 'journal.retention.pruned':
      case 'journal.sealed': {
        this.spanEvent(agent, e, e.type);
        return;
      }
      default: {
        if (TERMINAL.has(e.type)) {
          const span = agent;
          if (span !== undefined) {
            const d = e.data as { result?: unknown; error?: string; reason?: string; usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number } };
            if (e.type === 'agent.completed') span.status = { code: STATUS_OK };
            if (e.type === 'agent.failed') {
              span.status = { code: STATUS_ERROR, ...(d.error !== undefined && { message: d.error }) };
              span.attributes.push(attr('error.type', 'agent.failed'));
            }
            if (e.type === 'agent.cancelled') span.attributes.push(attr('naro.cancel.reason', d.reason ?? ''));
            if (d.usage !== undefined) {
              if (d.usage.inputTokens !== undefined) span.attributes.push(attr('gen_ai.usage.input_tokens', d.usage.inputTokens));
              if (d.usage.outputTokens !== undefined) span.attributes.push(attr('gen_ai.usage.output_tokens', d.usage.outputTokens));
              if (d.usage.costUsd !== undefined) span.attributes.push(attr('gen_ai.usage.cost_usd', d.usage.costUsd));
            }
            this.close(span, e, done);
            this.agents.delete(e.runId);
          }
        }
        return;
      }
    }
  }

  private close(span: OpenSpan, e: NaroEvent, done: OtlpSpan[]): void {
    done.push({
      traceId: span.traceId, spanId: span.spanId,
      ...(span.parentSpanId !== undefined && { parentSpanId: span.parentSpanId }),
      name: span.name, kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: String(span.startNanos), endTimeUnixNano: String(nanos(e.at)),
      attributes: span.attributes, events: span.events, status: span.status,
    });
  }

  export(events: readonly NaroEvent[]): Promise<void> {
    this.pending = this.pending.then(async () => {
      if (events.length === 0 || this.writeError) return;
      const done: OtlpSpan[] = [];
      try {
        for (const e of events) this.handle(e, done);
        if (done.length === 0) return;
        const res = await this.fetchImpl(`${this.opts.endpoint}/v1/traces`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...this.opts.headers },
          body: JSON.stringify(this.payload(done)),
        });
        if (!res.ok) throw new Error(`OTLP span export failed: ${res.status}`);
      } catch (err) {
        this.writeError = err;
      }
    });
    return this.pending;
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.writeError) throw this.writeError;
  }

  private payload(spans: OtlpSpan[]) {
    return {
      resourceSpans: [{
        resource: {
          attributes: [
            attr('service.name', this.opts.serviceName),
            attr('telemetry.sdk.name', '@naro/adapter-otel'),
          ],
        },
        scopeSpans: [{ scope: { name: 'naro.runtime' }, spans }],
      }],
    };
  }
}
