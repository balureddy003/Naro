import { newId } from './ids.ts';
import type { Goal } from './goal.ts';

/**
 * The identity half of an agent: who it is and what it's pursuing.
 *
 * The *composition* half (reasoner + tools + environment + policies)
 * lives in @naro/runtime — keeping wiring out of the core means this
 * package has zero dependencies and every contract stays testable
 * in isolation.
 */
export interface AgentSpec {
  readonly id: string;
  readonly name: string;
  readonly goal: Goal;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export function createAgentSpec(input: {
  name?: string;
  goal: Goal;
  metadata?: Record<string, unknown>;
}): AgentSpec {
  return {
    id: newId('agent'),
    name: input.name ?? 'agent',
    goal: input.goal,
    metadata: input.metadata ?? {},
  };
}
