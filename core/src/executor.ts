import type { Goal } from './goal.ts';
import type { Action } from './action.ts';
import type { Observation } from './observation.ts';

export interface ExecContext {
  readonly agentId: string;
  readonly goalId: string;
  /** The goal being served — nested executors (e.g. workflows) need it for policy. */
  readonly goal: Goal;
  /** Permissions granted to this agent — nested policy evaluation needs them. */
  readonly grants: readonly string[];
  readonly signal?: AbortSignal;
  /**
   * Resolves secret references ('env:NAME', 'vault:path#key') to values at
   * execution time. Secrets are resolved inside the executor and must never
   * be written into observations, events, or transcripts — redaction is the
   * backstop, not the boundary.
   */
  readonly secrets?: { resolve(ref: string): Promise<string | undefined> };
}

/**
 * Anything that can turn an Action into an Observation.
 *
 * This one seam unifies the whole "act" side of Naro: tools implement it,
 * environments implement it, and the runtime routes on `action.target`'s
 * scheme (`tool://…` → tools, `env://…` → environments). A new domain
 * plugs in by implementing this — never by changing the runtime.
 */
export interface ActionExecutor {
  execute(action: Action, ctx: ExecContext): Promise<Observation>;
}
