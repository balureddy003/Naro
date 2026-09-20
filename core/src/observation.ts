import { newId } from './ids.ts';

export type ObservationKind =
  | 'tool-result'    // a tool returned
  | 'env-change'     // the environment reported a change
  | 'verification'   // a verifier produced evidence
  | 'human'          // a person responded
  | 'system'         // runtime-generated (timeouts, cancellations)
  | 'error';         // something failed in a way worth observing

/**
 * An Observation is what the agent *learns* after acting or inspecting.
 *
 * Observations are deliberately separate from Actions and never collapsed
 * into a generic "message": an action is an intent, an observation is
 * evidence. The reasoning loop consumes observations to decide what to
 * do next.
 */
export interface Observation {
  readonly id: string;
  /** The action that produced this observation, if any. */
  readonly actionId?: string;
  /** Where it came from — 'tool://x', 'env://y', 'system', 'human'. */
  readonly source: string;
  readonly kind: ObservationKind;
  readonly success: boolean;
  readonly output?: unknown;
  readonly error?: string;
  readonly at: number;
}

export interface ObservationInput {
  actionId?: string;
  source: string;
  kind: ObservationKind;
  success: boolean;
  output?: unknown;
  error?: string;
}

export function createObservation(input: ObservationInput): Observation {
  return {
    id: newId('obs'),
    source: input.source,
    kind: input.kind,
    success: input.success,
    at: Date.now(),
    ...(input.actionId !== undefined && { actionId: input.actionId }),
    ...(input.output !== undefined && { output: input.output }),
    ...(input.error !== undefined && { error: input.error }),
  };
}
