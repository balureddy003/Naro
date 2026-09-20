import type { Action, PolicyContext, PolicyDecision, PolicyEngine } from '@naro/core';
import type { ToolRegistry } from './registry.ts';
import type { SideEffect } from './tool.ts';

export interface ToolPolicyOptions {
  /** Side effects that require human approval before running. */
  readonly approvalFor?: readonly SideEffect[]; // default ['destructive']
  /** Default verdict for non-tool targets. Default 'allow'. */
  readonly otherwise?: PolicyDecision;
}

/**
 * Builds a PolicyEngine from tool metadata.
 *
 * Rules (in order):
 *  1. Unknown tool or non-tool target → `otherwise`.
 *  2. Tool requires permissions the agent lacks → deny.
 *  3. Destructive (or configured) side effects → require_approval.
 *  4. Otherwise → allow.
 *
 * This is the baseline policy; deployments layer OPA/Rego behind the
 * same PolicyEngine interface for richer, declarative rules.
 */
export function createToolPolicy(
  registry: ToolRegistry,
  options: ToolPolicyOptions = {},
): PolicyEngine {
  const approvalFor = new Set(options.approvalFor ?? ['destructive']);
  const otherwise = options.otherwise ?? 'allow';

  return {
    evaluate(action: Action, ctx: PolicyContext): PolicyDecision {
      if (!action.target.startsWith('tool://')) return otherwise;
      const tool = registry.get(action.target.slice('tool://'.length));
      if (!tool) return otherwise;

      const missing = tool.permissions.filter((p) => !ctx.grants.includes(p));
      if (missing.length > 0) return 'deny';
      if (approvalFor.has(tool.sideEffects)) return 'require_approval';
      return 'allow';
    },
  };
}
