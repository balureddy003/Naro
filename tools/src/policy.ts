import type { Action, PolicyContext, PolicyDecision, PolicyEngine } from '@naro/core';
import type { ToolRegistry } from './registry.ts';
import type { SideEffect } from './tool.ts';

export interface ToolPolicyOptions {
  /** Side effects that require human approval before running. */
  readonly approvalFor?: readonly SideEffect[]; // default ['destructive']
  /**
   * Verdict for NON-tool targets (env://, …) — this engine doesn't own
   * those schemes, so 'allow' here means "abstain"; compose with engines
   * that do own them for real coverage. Default 'allow'.
   */
  readonly otherwise?: PolicyDecision;
  /**
   * Verdict for a `tool://` target naming no registered tool — a typo or
   * a hallucinated call. Default 'deny' (fail closed on unknown tools).
   */
  readonly unknownTool?: PolicyDecision;
}

/**
 * Builds a PolicyEngine from tool metadata.
 *
 * Rules (in order):
 *  1. Non-tool target → `otherwise` (abstain — another engine owns it).
 *  2. `tool://` naming no registered tool → `unknownTool` (default deny).
 *  3. Tool requires permissions the agent lacks → deny.
 *  4. Destructive (or configured) side effects → require_approval.
 *  5. Otherwise → allow.
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
  const unknownTool = options.unknownTool ?? 'deny';

  return {
    evaluate(action: Action, ctx: PolicyContext): PolicyDecision {
      if (!action.target.startsWith('tool://')) return otherwise;
      const tool = registry.get(action.target.slice('tool://'.length));
      if (!tool) return unknownTool; // a tool:// target that names nothing — fail closed

      const missing = tool.permissions.filter((p) => !ctx.grants.includes(p));
      if (missing.length > 0) return 'deny';
      if (approvalFor.has(tool.sideEffects)) return 'require_approval';
      return 'allow';
    },
  };
}
