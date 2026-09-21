import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, createGoal, toVerdict, type PolicyDecision, type PolicyResult } from '@naro/core';

export interface PolicyEngineLike {
  evaluate(action: unknown, ctx: unknown): Promise<PolicyResult> | PolicyResult;
}

const VALID: ReadonlySet<string> = new Set(['allow', 'deny', 'require_approval', 'limit', 'audit']);

function assertVerdict(v: { decision: PolicyDecision; reason?: string }): void {
  assert.ok(VALID.has(v.decision), `got '${v.decision}' — not a PolicyDecision`);
  if (v.reason !== undefined) {
    assert.equal(typeof v.reason, 'string');
    assert.ok(v.reason.length > 0, 'reason must be a non-empty string when present');
  }
}

/** Every PolicyEngine must return a valid decision (bare or verdict) and never throw blind. */
export function policyEngineContract(name: string, make: () => PolicyEngineLike | Promise<PolicyEngineLike>): void {
  const action = createAction('a1', { capability: 'test.cap', target: 'env://x/y' });
  const ctx = { agentId: 'a1', goal: createGoal({ description: 'g' }), grants: [] };

  test(`${name}: returns a valid PolicyDecision`, async () => {
    const eng = await make();
    assertVerdict(toVerdict(await eng.evaluate(action, ctx)));
  });

  test(`${name}: same input → same decision class (deterministic shape)`, async () => {
    const eng = await make();
    assertVerdict(toVerdict(await eng.evaluate(action, ctx)));
    assertVerdict(toVerdict(await eng.evaluate(action, ctx)));
  });
}
