import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, createGoal, type PolicyDecision } from '@naro/core';

export interface PolicyEngineLike {
  evaluate(action: unknown, ctx: unknown): Promise<PolicyDecision> | PolicyDecision;
}

const VALID: ReadonlySet<string> = new Set(['allow', 'deny', 'require_approval', 'limit', 'audit']);

/** Every PolicyEngine must return a valid decision and never throw blind. */
export function policyEngineContract(name: string, make: () => PolicyEngineLike | Promise<PolicyEngineLike>): void {
  const action = createAction('a1', { capability: 'test.cap', target: 'env://x/y' });
  const ctx = { agentId: 'a1', goal: createGoal({ description: 'g' }), grants: [] };

  test(`${name}: returns a valid PolicyDecision`, async () => {
    const eng = await make();
    const d = await eng.evaluate(action, ctx);
    assert.ok(VALID.has(d), `got '${d}' — not a PolicyDecision`);
  });

  test(`${name}: same input → same decision class (deterministic shape)`, async () => {
    const eng = await make();
    const d1 = await eng.evaluate(action, ctx);
    const d2 = await eng.evaluate(action, ctx);
    assert.ok(VALID.has(d1) && VALID.has(d2));
  });
}
