import type { Decision, Reasoner, ReasoningContext, StatefulReasoner } from '@naro/core';

/**
 * Cost-aware escalation — ADR 0014. Try the cheapest tier, escalate to a
 * stronger one only when the verifier says the cheaper output failed.
 *
 * Composes child `Reasoner`s (typically `ReActReasoner`s bound to
 * different `Model`s) behind one strategy identity. No new kernel surface:
 * escalation is driven entirely by what the runtime already journals —
 * failed verification lands as `kind: 'verification', success: false`
 * observations, which this reasoner counts in `ctx` before delegating.
 *
 *   new EscalatingReasoner([cheap, strong])  // cheap first, strong on failure
 *
 * Properties (per the ADR):
 *  - Never bypasses `deps.verifier` — it emits ordinary Decisions; the
 *    runtime's VERIFYING → REPLANNING transition is what makes escalation
 *    observable. This reasoner only reads that evidence.
 *  - Never de-escalates: once a tier has failed, returning to it would
 *    re-try a model already proven insufficient for this goal.
 *  - Which tier answered is auditable without a new event — the child's
 *    `model.usage` events and `ChatResponse.model` name it.
 *  - Checkpoint-safe: the current tier survives resume via captureState.
 */
export class EscalatingReasoner implements StatefulReasoner {
  readonly strategy: string;
  private readonly tiers: readonly Reasoner[];
  /** Verification failures required before moving up one tier. Default 1. */
  private readonly escalateAfter: number;
  private tier = 0;

  constructor(
    tiers: readonly Reasoner[],
    opts: { escalateAfterFailures?: number; strategy?: string } = {},
  ) {
    if (tiers.length < 2) throw new Error('EscalatingReasoner needs at least two tiers — escalation implies somewhere to go');
    this.tiers = tiers;
    this.escalateAfter = opts.escalateAfterFailures ?? 1;
    this.strategy = opts.strategy ?? `escalating(${tiers.map((t) => t.strategy).join('→')})`;
  }

  /** Which tier is currently answering — exposed for tests/inspection. */
  get currentTier(): number {
    return this.tier;
  }

  async decide(ctx: ReasoningContext): Promise<Decision> {
    const failures = ctx.observations.filter(
      (o) => o.kind === 'verification' && !o.success,
    ).length;
    const target = Math.min(Math.floor(failures / this.escalateAfter), this.tiers.length - 1);
    // Escalation is monotone: a cheaper tier that already failed this goal
    // is never retried — that's the cost pattern this class exists for.
    this.tier = Math.max(this.tier, target);
    return this.tiers[this.tier]!.decide(ctx);
  }

  captureState(): unknown {
    return { tier: this.tier };
  }

  restoreState(state: unknown): void {
    const t = (state as { tier?: unknown } | undefined)?.tier;
    if (typeof t === 'number') this.tier = Math.min(Math.max(0, t), this.tiers.length - 1);
  }
}
