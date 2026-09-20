import type { Action, PolicyContext, PolicyDecision, PolicyEngine } from '@naro/core';
import { InMemoryLimitStore, type LimitStore } from './limiter.ts';

/**
 * A declarative rule: when `when` matches, `then` is the verdict.
 * Rules are data — they can be loaded from config, generated, or
 * translated from Rego by an adapter. First match wins.
 */
export interface PolicyRule {
  readonly id: string;
  readonly description?: string;
  readonly when: (action: Action, ctx: PolicyContext) => boolean;
  readonly then: PolicyDecision;
  /** Required when `then === 'limit'`: allow up to N calls per window. */
  readonly limit?: { readonly maxCalls: number; readonly windowMs?: number };
}

export interface AuditEntry {
  readonly at: number;
  readonly actionId: string;
  readonly target: string;
  readonly decision: PolicyDecision;
  readonly ruleId: string;
}

/**
 * Composable rule engine.
 *
 * - First matching rule decides.
 * - `limit` rules keep a per-rule call window: under the cap → allow,
 *   past it → deny (the limit itself is the enforcement).
 * - `audit` rules allow *and* append to an inspectable audit log —
 *   "allowed, but on the record."
 */
export class RulePolicyEngine implements PolicyEngine {
  private readonly rules: readonly PolicyRule[];
  private readonly defaultDecision: PolicyDecision;
  private readonly limits: LimitStore;
  private readonly log: AuditEntry[] = [];

  constructor(rules: readonly PolicyRule[], options: { default?: PolicyDecision; limits?: LimitStore } = {}) {
    this.rules = rules;
    this.defaultDecision = options.default ?? 'allow';
    this.limits = options.limits ?? new InMemoryLimitStore();
  }

  evaluate(action: Action, ctx: PolicyContext): Promise<PolicyDecision> | PolicyDecision {
    for (const rule of this.rules) {
      if (!rule.when(action, ctx)) continue;
      if (rule.then === 'limit') return this.limitVerdict(rule, action);
      if (rule.then === 'audit') {
        this.log.push({ at: Date.now(), actionId: action.id, target: action.target, decision: 'audit', ruleId: rule.id });
      }
      return rule.then;
    }
    return this.defaultDecision;
  }

  private limitVerdict(rule: PolicyRule, action: Action): PolicyDecision | Promise<PolicyDecision> {
    const spec = rule.limit ?? { maxCalls: 1 };
    // record() counts this call — attempts past the cap count too (that's
    // what makes a rate limit a rate limit, not a success quota).
    const n = this.limits.record(rule.id, spec.windowMs, Date.now());
    const settle = (count: number): PolicyDecision => {
      const decision: PolicyDecision = count <= spec.maxCalls ? 'allow' : 'deny';
      this.log.push({ at: Date.now(), actionId: action.id, target: action.target, decision, ruleId: rule.id });
      return decision;
    };
    // In-memory stays synchronous; durable stores go async.
    return typeof n === 'number' ? settle(n) : n.then(settle);
  }

  /** The audit trail — which rules fired, on which actions. */
  auditLog(): readonly AuditEntry[] {
    return this.log;
  }
}

// --- Rule builders: the common cases as one-liners ----------------------

/** Deny any action matching a capability or target glob ('env.*', 'tool://db*'). */
export function denyCapability(pattern: string, opts: { id?: string; description?: string } = {}): PolicyRule {
  const re = glob(pattern);
  return {
    id: opts.id ?? `deny:${pattern}`,
    ...(opts.description !== undefined && { description: opts.description }),
    when: (a) => re.test(a.capability) || re.test(a.target),
    then: 'deny',
  };
}

/** Require human approval for matching actions (e.g. 'tool://delete-*'). */
export function requireApproval(pattern: string, opts: { id?: string } = {}): PolicyRule {
  const re = glob(pattern);
  return {
    id: opts.id ?? `approve:${pattern}`,
    when: (a) => re.test(a.capability) || re.test(a.target),
    then: 'require_approval',
  };
}

/** Cap calls to matching actions: N per window (default: N total). */
export function limitCalls(pattern: string, maxCalls: number, windowMs?: number): PolicyRule {
  const re = glob(pattern);
  return {
    id: `limit:${pattern}`,
    when: (a) => re.test(a.capability) || re.test(a.target),
    then: 'limit',
    limit: { maxCalls, ...(windowMs !== undefined && { windowMs }) },
  };
}

/** Allow matching actions but record every one to the audit log. */
export function auditCalls(pattern: string, opts: { id?: string } = {}): PolicyRule {
  const re = glob(pattern);
  return {
    id: opts.id ?? `audit:${pattern}`,
    when: (a) => re.test(a.capability) || re.test(a.target),
    then: 'audit',
  };
}

/** Deny actions that request permissions the agent doesn't hold. */
export function requireGrants(): PolicyRule {
  return {
    id: 'require-grants',
    description: 'action.permissions must be a subset of agent grants',
    when: (a, ctx) => a.permissions.some((p) => !ctx.grants.includes(p)),
    then: 'deny',
  };
}

/** '*' and '**' glob → RegExp. 'env.*' matches 'env.set', 'tool://db*' etc. */
function glob(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '[^/]*')
    .replace(//g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Compose engines conjunctively: every engine evaluates; the strictest
 * verdict wins (deny > require_approval > limit > audit > allow).
 *
 * Use it to layer jurisdictions — e.g. a tool policy for `tool://`,
 * a rule engine for `env://`, an OPA adapter for org-wide rules —
 * without any engine needing to know the others exist.
 */
export function allOf(...engines: readonly PolicyEngine[]): PolicyEngine {
  const strictness: Record<PolicyDecision, number> = {
    deny: 4, require_approval: 3, limit: 2, audit: 1, allow: 0,
  };
  return {
    async evaluate(action: Action, ctx: PolicyContext): Promise<PolicyDecision> {
      let verdict: PolicyDecision = 'allow';
      for (const engine of engines) {
        const d = await engine.evaluate(action, ctx);
        if (strictness[d] > strictness[verdict]) verdict = d;
        if (verdict === 'deny') break; // nothing is stricter — short-circuit
      }
      return verdict;
    },
  };
}
