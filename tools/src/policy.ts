import type { Action, PolicyContext, PolicyDecision, PolicyEngine, PolicyVerdict } from '@naro/core';
import type { ToolRegistry } from './registry.ts';
import type { SideEffect } from './tool.ts';

export interface ToolPolicyOptions {
  /** Engine identity stamped on gate events. Default 'tool-policy'. */
  readonly id?: string;
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
  /**
   * Side effects refused when the triggering evidence was external —
   * e.g. ['destructive','write'] blocks a web page from talking the agent
   * into a shell command. Default: none (opt-in).
   */
  readonly denyExternalTriggered?: readonly SideEffect[];
}

/**
 * Builds a PolicyEngine from tool metadata.
 *
 * Rules (in order):
 *  1. Non-tool target → `otherwise` (abstain — another engine owns it).
 *  2. `tool://` naming no registered tool → `unknownTool` (default deny).
 *  3. Tool requires permissions the agent lacks → deny.
 *  4. External-triggered side effect in `denyExternalTriggered` → deny.
 *  5. Destructive (or configured) side effects → require_approval.
 *  6. Otherwise → allow.
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
  const denyExternal = new Set(options.denyExternalTriggered ?? []);

  return {
    id: options.id ?? 'tool-policy',
    evaluate(action: Action, ctx: PolicyContext): PolicyVerdict {
      if (!action.target.startsWith('tool://')) return { decision: otherwise };
      const name = action.target.slice('tool://'.length);
      const tool = registry.get(name);
      if (!tool) {
        return { decision: unknownTool, reason: `no registered tool '${name}'` };
      }

      const missing = tool.permissions.filter((p) => !ctx.grants.includes(p));
      if (missing.length > 0) return { decision: 'deny', reason: `missing grants: ${missing.join(', ')}` };
      if (ctx.provenance?.lowest === 'external' && denyExternal.has(tool.sideEffects)) {
        return {
          decision: 'deny',
          reason: `${tool.sideEffects} side effect triggered by external evidence (${ctx.provenance.externalSources.join(', ')})`,
        };
      }
      if (approvalFor.has(tool.sideEffects)) {
        return { decision: 'require_approval', reason: `${tool.sideEffects} side effect requires approval` };
      }
      return { decision: 'allow' };
    },
  };
}
