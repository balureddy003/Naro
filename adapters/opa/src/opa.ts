import type { Action, PolicyContext, PolicyDecision, PolicyEngine, PolicyVerdict } from '@naro/core';

/**
 * OPA adapter: every action becomes a Rego query.
 *
 * Policy authors write data.naro.action.decision rules; Naro stays
 * engine-agnostic. One POST per action to /v1/data/<decisionPath>.
 *
 * Expected document shape:
 *   package naro.action
 *   decision := "deny" if { ... }   # any of the five PolicyDecisions
 *   decision := "allow" if { ... }
 *
 * Failure posture is explicit: unreachable OPA → deny (fail-closed)
 * unless opts.onError says otherwise. A policy engine that fails open
 * is worse than none.
 */

export interface OpaOptions {
  /** OPA base URL, e.g. 'http://localhost:8181'. */
  readonly url: string;
  /** Engine identity stamped on gate events. Default 'opa'. */
  readonly id?: string;
  /** Rego document path whose value is the decision. Default: 'naro/action/decision'. */
  readonly decisionPath?: string;
  /** What to do when OPA is unreachable or returns garbage. Default: deny. */
  readonly onError?: 'deny' | 'allow';
  readonly headers?: Record<string, string>;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const DECISIONS: ReadonlySet<string> = new Set(['allow', 'deny', 'require_approval', 'limit', 'audit']);

export class OpaPolicyEngine implements PolicyEngine {
  readonly id: string;
  private readonly opts: OpaOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpaOptions) {
    this.opts = opts;
    this.id = opts.id ?? 'opa';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async evaluate(action: Action, ctx: PolicyContext): Promise<PolicyVerdict> {
    const path = this.opts.decisionPath ?? 'naro/action/decision';
    const input = {
      action: {
        id: action.id, capability: action.capability, target: action.target,
        input: action.input, actor: action.actor,
      },
      agent: { id: ctx.agentId, grants: ctx.grants },
      goal: { id: ctx.goal.id, description: ctx.goal.description },
    };
    try {
      const res = await this.fetchImpl(`${this.opts.url}/v1/data/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.opts.headers },
        body: JSON.stringify({ input }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5_000),
      });
      if (!res.ok) return this.onError(`OPA ${res.status}`);
      const body = await res.json() as { result?: unknown };
      // result may be a bare decision string or {decision, reason} —
      // the object form lets Rego say *why* (lands in the evidence record).
      const result = typeof body.result === 'object' && body.result !== null
        ? (body.result as { decision?: unknown; reason?: unknown })
        : { decision: body.result };
      if (typeof result.decision === 'string' && DECISIONS.has(result.decision)) {
        return {
          decision: result.decision as PolicyDecision,
          ...(typeof result.reason === 'string' && { reason: result.reason }),
        };
      }
      return this.onError(`OPA returned non-decision: ${JSON.stringify(body.result)}`);
    } catch (e) {
      return this.onError(e instanceof Error ? e.message : String(e));
    }
  }

  private onError(why: string): PolicyVerdict {
    if ((this.opts.onError ?? 'deny') === 'allow') return { decision: 'allow' };
    return { decision: 'deny', reason: why }; // fail-closed; the reason lands in the observation via runner
  }
}
