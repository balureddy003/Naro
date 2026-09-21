import type { Action } from './action.ts';
import type { Goal } from './goal.ts';
import type { TrustLevel } from './observation.ts';

/**
 * What the policy engine can say about an action.
 *
 *  - `allow` — proceed.
 *  - `deny` — refused; becomes an observation the reasoner must see.
 *  - `require_approval` — park in WAITING_FOR_HUMAN until a HumanBridge answers.
 *  - `limit` — allowed, but counted/throttled by the engine (rate/cost caps);
 *    the engine itself denies once the cap is exhausted.
 *  - `audit` — allowed, and flagged for the audit record.
 */
export type PolicyDecision = 'allow' | 'deny' | 'require_approval' | 'limit' | 'audit';

export interface PolicyContext {
  readonly agentId: string;
  readonly goal: Goal;
  /** Permissions this agent has been granted (e.g. 'fs.read', 'net.http'). */
  readonly grants: readonly string[];
  /** Trust of the evidence the reasoner saw before requesting this action —
   *  the lowest trust level among recent observations. Lets a rule deny
   *  side effects when the triggering evidence came from outside. */
  readonly provenance?: { readonly lowest: TrustLevel; readonly externalSources: readonly string[] };
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
