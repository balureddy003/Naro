import { InvalidTransitionError } from './errors.ts';

/**
 * The agent lifecycle, as explicit states.
 *
 * Why explicit states instead of a while-loop? Because a state machine
 * can be *checked*: every transition is validated, persisted, and
 * observable — so a paused agent can be resumed, a failed one recovered,
 * and an audit can reconstruct exactly what happened.
 */
export const AGENT_STATES = [
  'CREATED',
  'INITIALIZING',
  'UNDERSTANDING',
  'PLANNING',
  'WAITING_FOR_CONTEXT',
  'REASONING',
  'WAITING_FOR_PERMISSION',
  'ACTING',
  'OBSERVING',
  'VERIFYING',
  'REPLANNING',
  'WAITING_FOR_HUMAN',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'PAUSED',
  'RECOVERING',
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

/**
 * The legal moves. Design rules baked into the table:
 *
 *  - Every action must pass WAITING_FOR_PERMISSION — policy is not optional.
 *  - PAUSED only goes through RECOVERING to resume (a checkpoint decides where).
 *  - FAILED is semi-terminal: it may transition to RECOVERING, but never
 *    silently back to work.
 *  - COMPLETED and CANCELLED are truly terminal.
 */
export const TRANSITIONS: Record<AgentState, readonly AgentState[]> = {
  CREATED:               ['INITIALIZING', 'CANCELLED'],
  INITIALIZING:          ['UNDERSTANDING', 'RECOVERING', 'FAILED', 'CANCELLED'],  // RECOVERING: init found a checkpoint
  UNDERSTANDING:         ['PLANNING', 'FAILED', 'CANCELLED', 'PAUSED'],
  PLANNING:              ['WAITING_FOR_CONTEXT', 'REASONING', 'FAILED', 'CANCELLED', 'PAUSED'],
  WAITING_FOR_CONTEXT:   ['REASONING', 'FAILED', 'CANCELLED', 'PAUSED'],
  REASONING:             ['WAITING_FOR_CONTEXT', 'WAITING_FOR_PERMISSION', 'VERIFYING', 'REPLANNING',
                          'WAITING_FOR_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED'],
  WAITING_FOR_PERMISSION:['ACTING', 'REASONING', 'WAITING_FOR_HUMAN', 'FAILED', 'CANCELLED', 'PAUSED'],
  ACTING:                ['OBSERVING', 'FAILED', 'CANCELLED', 'PAUSED'],
  OBSERVING:             ['VERIFYING', 'REASONING', 'FAILED', 'CANCELLED', 'PAUSED'],
  VERIFYING:             ['REASONING', 'REPLANNING', 'WAITING_FOR_HUMAN',
                          'COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED'],
  REPLANNING:            ['PLANNING', 'REASONING', 'FAILED', 'CANCELLED', 'PAUSED'],
  WAITING_FOR_HUMAN:     ['REASONING', 'PLANNING', 'WAITING_FOR_PERMISSION', 'FAILED', 'CANCELLED', 'PAUSED'],  // →PERMISSION: approval granted, back to the gate
  PAUSED:                ['RECOVERING', 'CANCELLED'],
  RECOVERING:            ['UNDERSTANDING', 'PLANNING', 'WAITING_FOR_CONTEXT', 'REASONING',
                          'WAITING_FOR_PERMISSION', 'ACTING', 'OBSERVING', 'VERIFYING',
                          'REPLANNING', 'WAITING_FOR_HUMAN', 'FAILED', 'CANCELLED'],
  FAILED:                ['RECOVERING', 'CANCELLED'],
  COMPLETED:             [],
  CANCELLED:             [],
};

export function canTransition(from: AgentState, to: AgentState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throws InvalidTransitionError if the move is not in the table. */
export function assertTransition(from: AgentState, to: AgentState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(state: AgentState): boolean {
  return state === 'COMPLETED' || state === 'CANCELLED';
}

/** Semi-terminal: execution has stopped, but recovery is still possible. */
export function isStopped(state: AgentState): boolean {
  return isTerminal(state) || state === 'FAILED' || state === 'PAUSED';
}
