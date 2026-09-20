import { createGoal } from '@naro/core';
import type { Tool } from '@naro/tools';
import type { AgentBus, AgentDirectory } from './bus.ts';

/**
 * Delegation-as-tool: a standard Tool whose execute() sends a task
 * request over the bus. This is the whole trick — delegation flows
 * through the same authorize → validate → execute → observe pipeline
 * as every other action, so policy can gate which agents may be
 * addressed and humans can approve cross-agent calls.
 */
export function delegationTool(
  bus: AgentBus,
  fromAgentId: string,
  directory?: AgentDirectory,
): Tool {
  return {
    name: 'delegate',
    description: 'Delegate a goal to another agent and await its result',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'target agent id' },
        goal: { type: 'string', description: 'what the agent should accomplish' },
      },
      required: ['agent', 'goal'],
    },
    permissions: ['agent.delegate'],
    sideEffects: 'write',
    metadata: { directory },
    execute: async (input) => {
      const { agent, goal } = input as { agent: string; goal: string };
      if (directory && !directory.get(agent)) {
        throw new Error(`unknown agent '${agent}' — directory has: ${directory.list().map((a) => a.id).join(', ') || 'none'}`);
      }
      return bus.request(agent, createGoal({ description: goal }), fromAgentId);
    },
  };
}
