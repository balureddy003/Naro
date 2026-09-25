import type { AgentDeps } from '@naro/runtime';
import type { Model } from '@naro/model';
import type { Tool } from '@naro/tools';

/**
 * An outcome template — PRD-002's unit of packaging.
 *
 * A template is the same composition docs/use-cases.md asks every Naro
 * application to define, packaged once so a business doesn't assemble it:
 *   goal shape + tool set + policy + verifier + budget + tier config.
 *
 * The template supplies everything *except the models* — the caller owns
 * the reasoner tiers (e.g. `ollamaCheapTier()` + a frontier model), so the
 * same template runs on a laptop or a fleet.
 *
 * Templates version independently (`version` is per-template, not the
 * package's): improving one template's verifier must never force a
 * re-test of the others.
 */
export interface OutcomeTemplate<I = unknown> {
  readonly id: string;
  readonly version: string;
  /**
   * The declared contract — visible before running, not discovered after:
   * what the template does, what a run should cost, what "worked" means.
   */
  readonly outcome: {
    readonly description: string;
    /** Declared expectations — the budget the runner enforces lives in
     *  build()'s AgentDeps; these numbers are the business-facing claim. */
    readonly expectedCostUsd?: { readonly typical?: number; readonly max?: number };
    readonly successThreshold: string;
  };
  /** Compose a runnable agent for one input — `new AgentRunner(template.build(input, deps))`. */
  build(input: I, deps: TemplateDeps): AgentDeps;
}

export interface TemplateDeps {
  /**
   * The cheap tier's model — e.g. `ollamaCheapTier().model`, a provider's
   * small model, or `MockModel` in tests. A template takes *models*, not
   * reasoners, because the reasoner must be built around the template's
   * own tool specs — strategy and tools are the template's to wire.
   */
  readonly cheap: Model;
  /**
   * The model `EscalatingReasoner` falls up to when the cheap tier's
   * answers fail verification. Defaults to `cheap` (single-tier — no
   * escalation; verification still gates the run).
   */
  readonly strong?: Model;
  /** Failed verifications before escalating. Default 2. */
  readonly escalateAfter?: number;
  /**
   * Deployment-added tools folded into the template's registry, reasoner
   * specs, and policy — e.g. a `delegate` tool or a `remember` tool the
   * deployment owns. ADR 0028: the template still owns strategy; this is
   * where a deployment extends its own composition, not where template
   * logic lives.
   */
  readonly extraTools?: readonly Tool[];
  /** Grants the extra tools need — explicit, never auto-derived. */
  readonly extraGrants?: readonly string[];
}
