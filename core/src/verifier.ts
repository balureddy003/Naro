import type { Goal } from './goal.ts';
import type { Observation } from './observation.ts';

/** Verification is evidence, not vibes: pass/fail plus *why*. */
export interface Verification {
  readonly ok: boolean;
  readonly evidence?: unknown;
  readonly reason?: string;
}

export interface VerifyInput {
  readonly goal: Goal;
  /** The observation under scrutiny (action-level verification). */
  readonly observation?: Observation;
  /** The claimed final result (goal-level verification). */
  readonly result?: unknown;
}

/**
 * A Verifier gives the environment — not the model — the last word on
 * success. A code agent's verifier runs tests; a data agent's checks
 * schema; an enterprise agent's may be a human approver.
 *
 * Called per action (with `observation`) and on the completion claim
 * (with `result`); see @naro/verification `atCompletion`/`perAction` to scope.
 */
export interface Verifier {
  readonly id: string;
  verify(input: VerifyInput): Promise<Verification> | Verification;
}
