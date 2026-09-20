import { newId } from './ids.ts';

/**
 * A Goal is what the agent is trying to accomplish.
 *
 * Goals are immutable once execution starts — an agent may replan, retry,
 * or fail, but it never quietly edits the goal it was given. Success is
 * defined by `successCriteria`, which a Verifier can check with evidence
 * rather than the model asserting "done".
 */
export interface Goal {
  readonly id: string;
  /** Human-readable statement of intent. */
  readonly description: string;
  /** Hard limits the agent must respect, e.g. "no network access". */
  readonly constraints: readonly string[];
  /** Observable conditions that define "done". */
  readonly successCriteria: readonly string[];
  readonly priority: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface GoalInput {
  description: string;
  constraints?: readonly string[];
  successCriteria?: readonly string[];
  priority?: number;
  metadata?: Readonly<Record<string, unknown>>;
}

export function createGoal(input: GoalInput): Goal {
  return {
    id: newId('goal'),
    description: input.description,
    constraints: input.constraints ?? [],
    successCriteria: input.successCriteria ?? [],
    priority: input.priority ?? 0,
    metadata: input.metadata ?? {},
  };
}
