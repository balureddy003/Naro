import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, createGoal, type PolicyContext } from '@naro/core';
import { RulePolicyEngine, denyCapability, requireApproval, limitCalls, auditCalls, requireGrants } from './rules.ts';

const goal = createGoal({ description: 'test' });
const ctx = (grants: string[] = []): PolicyContext => ({ agentId: 'a1', goal, grants });
const act = (capability: string, target: string, permissions: string[] = []) =>
  createAction('a1', { capability, target, permissions });

test('first matching rule wins', () => {
  const p = new RulePolicyEngine([
    denyCapability('env.delete'),
    requireApproval('tool://*'),
  ]);
  assert.equal(p.evaluate(act('env.delete', 'env://local/k'), ctx()), 'deny');
  assert.equal(p.evaluate(act('tool.invoke', 'tool://x'), ctx()), 'require_approval');
  assert.equal(p.evaluate(act('env.get', 'env://local/k'), ctx()), 'allow');
});

test('limit allows up to the cap, then denies', () => {
  const p = new RulePolicyEngine([limitCalls('tool://expensive', 2)]);
  assert.equal(p.evaluate(act('tool.invoke', 'tool://expensive'), ctx()), 'allow');
  assert.equal(p.evaluate(act('tool.invoke', 'tool://expensive'), ctx()), 'allow');
  assert.equal(p.evaluate(act('tool.invoke', 'tool://expensive'), ctx()), 'deny');
});

test('audit rules allow and record', () => {
  const p = new RulePolicyEngine([auditCalls('env.*')]);
  assert.equal(p.evaluate(act('env.set', 'env://local/k'), ctx()), 'audit');
  const log = p.auditLog();
  assert.equal(log.length, 1);
  assert.equal(log[0]!.target, 'env://local/k');
});

test('requireGrants denies ungranted permission requests', () => {
  const p = new RulePolicyEngine([requireGrants()]);
  assert.equal(p.evaluate(act('env.set', 'env://x', ['fs.write']), ctx([])), 'deny');
  assert.equal(p.evaluate(act('env.set', 'env://x', ['fs.write']), ctx(['fs.write'])), 'allow');
});

test('default decision applies when nothing matches', () => {
  const p = new RulePolicyEngine([denyCapability('nothing.matches')], { default: 'require_approval' });
  assert.equal(p.evaluate(act('env.get', 'env://x'), ctx()), 'require_approval');
});
