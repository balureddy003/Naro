import { createGoal, type ExecContext, type Goal } from '@naro/core';
import type { Tool } from '@naro/tools';
import type { AgentBus, AgentDirectory } from './bus.ts';

/**
 * Delegation-as-tool: a standard Tool whose execute() sends a task
 * request over the bus. This is the whole trick — delegation flows
 * through the same authorize → validate → execute → observe pipeline
 * as every other action, so policy can gate which agents may be
 * addressed and humans can approve cross-agent calls.
 *
 * `bounds` make a subagent *bounded* in the Raschka sense: it inherits
 * only what the parent chooses to hand down — a depth cap, a capability
 * allowlist, a grant subset, and scoped context. The bounds travel in the
 * child goal's metadata (`naro:depth`, `naro:capabilities`, `naro:grants`)
 * and as a human-readable constraint; the child's composition applies them
 * through `delegationConstraints(goal)`.
 */
export interface DelegationBounds {
  /** Deepest allowed delegation depth. 'naro:depth' propagates per hop. */
  readonly maxDepth?: number;
  /** Capabilities the child may exercise — e.g. read-only: ['fs.read', 'env.get']. */
  readonly allowedCapabilities?: readonly string[];
  /** Permissions the child may hold — a subset of the parent's, ideally. */
  readonly grants?: readonly string[];
  /** Scoped context handed to the child — not the parent's whole world. */
  readonly context?: string;
}

/** The common case: a side-question agent that can look but not touch. */
export const READ_ONLY_DELEGATION: DelegationBounds = {
  maxDepth: 1,
  allowedCapabilities: ['fs.read', 'fs.list', 'env.get', 'env.list', 'tool.invoke'],
};

const META_DEPTH = 'naro:depth';
const META_CAPS = 'naro:capabilities';
const META_GRANTS = 'naro:grants';
const META_CONTEXT = 'naro:context';
const META_TRACE = 'naro:traceId';

/** What a delegated goal carries — read by the child's composition. */
export function delegationConstraints(goal: Goal): {
  depth: number;
  capabilities?: readonly string[];
  grants?: readonly string[];
  context?: string;
  /** The parent run's trace id — pass to `AgentRunner.run({ traceId })` so the child's journal correlates with the parent's. */
  traceId?: string;
} {
  const m = goal.metadata;
  return {
    depth: typeof m[META_DEPTH] === 'number' ? m[META_DEPTH] : 0,
    ...(Array.isArray(m[META_CAPS]) && { capabilities: m[META_CAPS] as string[] }),
    ...(Array.isArray(m[META_GRANTS]) && { grants: m[META_GRANTS] as string[] }),
    ...(typeof m[META_CONTEXT] === 'string' && { context: m[META_CONTEXT] as string }),
    ...(typeof m[META_TRACE] === 'string' && { traceId: m[META_TRACE] as string }),
  };
}

export function delegationTool(
  bus: AgentBus,
  fromAgentId: string,
  directory?: AgentDirectory,
  bounds?: DelegationBounds,
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
    metadata: { directory, bounds },
    execute: async (input, ctx: ExecContext) => {
      const { agent, goal } = input as { agent: string; goal: string };
      if (directory && !directory.get(agent)) {
        throw new Error(`unknown agent '${agent}' — directory has: ${directory.list().map((a) => a.id).join(', ') || 'none'}`);
      }

      const depth = delegationConstraints(ctx.goal).depth;
      if (bounds?.maxDepth !== undefined && depth >= bounds.maxDepth) {
        throw new Error(`delegation depth ${bounds.maxDepth} reached — answer directly instead of delegating`);
      }

      const description = bounds?.context
        ? `${goal}\n\nCONTEXT (scoped by parent):\n${bounds.context}`
        : goal;
      const child = createGoal({
        description,
        constraints: bounds?.allowedCapabilities
          ? [`You may only use capabilities: ${bounds.allowedCapabilities.join(', ')}`]
          : [],
        metadata: {
          [META_DEPTH]: depth + 1,
          ...(bounds?.allowedCapabilities !== undefined && { [META_CAPS]: [...bounds.allowedCapabilities] }),
          ...(bounds?.grants !== undefined && { [META_GRANTS]: [...bounds.grants] }),
          ...(bounds?.context !== undefined && { [META_CONTEXT]: bounds.context }),
          // Carries the parent's traceId to the child so a delegation chain's
          // independently hash-chained journals still correlate as one trace.
          ...(ctx.traceId !== undefined && { [META_TRACE]: ctx.traceId }),
        },
      });
      return bus.request(agent, child, fromAgentId);
    },
  };
}
