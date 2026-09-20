import type { NaroEvent } from '@naro/core';
import type { EventExporter } from '@naro/observability';

/**
 * OTLP/HTTP exporter: NaroEvents become OTLP log records POSTed to a
 * collector (Jaeger, Grafana, Honeycomb, otel-collector — anything that
 * speaks /v1/logs).
 *
 * Why logs, not spans: events are facts in sequence, not a trace tree.
 * Mapping them into spans would invent parentage the stream doesn't
 * carry. When events gain span/timing structure, a span mapping can be
 * added honestly. No OTel SDK dependency — same raw-fetch style as the
 * other adapters.
 */

export interface OtlpExporterOptions {
  /** Collector base URL, e.g. 'http://localhost:4318'. */
  readonly endpoint: string;
  readonly serviceName?: string;
  /** Extra headers — auth tokens, tenant IDs. */
  readonly headers?: Record<string, string>;
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
}

type OtlpValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };

function attr(key: string, value: unknown): { key: string; value: OtlpValue } {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number' && Number.isInteger(value)) return { key, value: { intValue: String(value) } };
  if (typeof value === 'number') return { key, value: { doubleValue: value } };
  return { key, value: { stringValue: typeof value === 'string' ? value : JSON.stringify(value) } };
}

// OTLP severity numbers: INFO=9, WARN=13, ERROR=17
const SEVERITY: Readonly<Record<string, number>> = {
  'agent.failed': 17, 'action.denied': 13, 'verification.completed': 9,
  'human.approval.requested': 13, 'replan.triggered': 13,
};

export function toLogRecord(e: NaroEvent) {
  return {
    timeUnixNano: String(e.at * 1_000_000),
    severityNumber: SEVERITY[e.type] ?? 9,
    severityText: (SEVERITY[e.type] ?? 9) >= 13 ? 'WARN' : 'INFO',
    body: { stringValue: e.type },
    attributes: [
      attr('naro.event.seq', e.seq),
      attr('naro.agent.id', e.agentId),
      attr('naro.goal.id', e.goalId),
      attr('naro.event.id', e.id),
      attr('naro.event.data', e.data),
    ],
  };
}

export class OtlpExporter implements EventExporter {
  private readonly opts: Required<Pick<OtlpExporterOptions, 'serviceName'>> & OtlpExporterOptions;
  private readonly fetchImpl: typeof fetch;
  private pending: Promise<void> = Promise.resolve();

  constructor(opts: OtlpExporterOptions) {
    this.opts = { serviceName: 'naro', ...opts };
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  export(events: readonly NaroEvent[]): Promise<void> {
    this.pending = this.pending.then(async () => {
      if (events.length === 0) return;
      const res = await this.fetchImpl(`${this.opts.endpoint}/v1/logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.opts.headers },
        body: JSON.stringify(this.payload(events)),
      });
      if (!res.ok) throw new Error(`OTLP export failed: ${res.status}`);
    });
    return this.pending;
  }

  flush(): Promise<void> {
    return this.pending;
  }

  private payload(events: readonly NaroEvent[]) {
    return {
      resourceLogs: [{
        resource: {
          attributes: [
            attr('service.name', this.opts.serviceName),
            attr('service.version', '0.1.0'),
            attr('telemetry.sdk.name', '@naro/adapter-otel'),
          ],
        },
        scopeLogs: [{
          scope: { name: 'naro.runtime' },
          logRecords: events.map(toLogRecord),
        }],
      }],
    };
  }
}
