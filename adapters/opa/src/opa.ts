import type { Action, PolicyContext, PolicyDecision, PolicyEngine } from '@naro/core';

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
  private readonly opts: OpaOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpaOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async evaluate(action: Action, ctx: PolicyContext): Promise<PolicyDecision> {
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
      const decision = typeof body.result === 'string' ? body.result : undefined;
      if (decision && DECISIONS.has(decision)) return decision as PolicyDecision;
      return this.onError(`OPA returned non-decision: ${JSON.stringify(body.result)}`);
    } catch (e) {
      return this.onError(e instanceof Error ? e.message : String(e));
    }
  }

  private onError(why: string): PolicyDecision {
    if ((this.opts.onError ?? 'deny') === 'allow') return 'allow';
    return 'deny'; // fail-closed; the reason lands in the observation via runner
  }
}
