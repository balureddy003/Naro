import type { Action } from './action.ts';
import type { Goal } from './goal.ts';

/**
 * What the policy engine can say about an action.
 * 'require_approval' pushes the agent into WAITING_FOR_HUMAN until a
 * HumanBridge answers — policy can pause the world, not just veto it.
 */
export type PolicyDecision = 'allow' | 'deny' | 'require_approval';

export interface PolicyContext {
  readonly agentId: string;
  readonly goal: Goal;
  /** Permissions this agent has been granted (e.g. 'fs.read', 'net.http'). */
  readonly grants: readonly string[];
}

/**
 * The single gate every action passes through.
 *
 * Rule: policies decide *from outside* the action — a model can request
 * anything, but it can never grant itself permission. Default impls live
 * in @naro/tools; an OPA/Rego adapter can implement this same interface.
 */
export interface PolicyEngine {
  evaluate(action: Action, ctx: PolicyContext): Promise<PolicyDecision> | PolicyDecision;
}

/** Permissive default so a minimal agent needs zero config. See docs/policy. */
export const allowAllPolicy: PolicyEngine = {
  evaluate: () => 'allow',
};
