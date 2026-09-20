import type { Action } from './action.ts';
import type { Observation } from './observation.ts';

export interface ExecContext {
  readonly agentId: string;
  readonly goalId: string;
  readonly signal?: AbortSignal;
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
