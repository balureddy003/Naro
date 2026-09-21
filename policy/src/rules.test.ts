import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, createGoal, toVerdict, type PolicyContext, type PolicyResult } from '@naro/core';
import { RulePolicyEngine, denyCapability, requireApproval, limitCalls, auditCalls, requireGrants, allOf } from './rules.ts';

const goal = createGoal({ description: 'test' });
const ctx = (grants: string[] = []): PolicyContext => ({ agentId: 'a1', goal, grants });
const act = (capability: string, target: string, permissions: string[] = []) =>
  createAction('a1', { capability, target, permissions });
const decision = async (r: PolicyResult | Promise<PolicyResult>) => toVerdict(await r).decision;

test('first matching rule wins', async () => {
  const p = new RulePolicyEngine([
    denyCapability('env.delete'),
    requireApproval('tool://*'),
  ]);
  assert.equal(await decision(p.evaluate(act('env.delete', 'env://local/k'), ctx())), 'deny');
  assert.equal(await decision(p.evaluate(act('tool.invoke', 'tool://x'), ctx())), 'require_approval');
  assert.equal(await decision(p.evaluate(act('env.get', 'env://local/k'), ctx())), 'allow');
});

test('verdicts carry the rule id as reason', async () => {
  const p = new RulePolicyEngine([denyCapability('env.delete', { id: 'no-delete' })]);
  const v = toVerdict(await p.evaluate(act('env.delete', 'env://local/k'), ctx()));
  assert.equal(v.decision, 'deny');
  assert.equal(v.reason, 'rule no-delete');
});

test('limit allows up to the cap, then denies', async () => {
  const p = new RulePolicyEngine([limitCalls('tool://expensive', 2)]);
  assert.equal(await decision(p.evaluate(act('tool.invoke', 'tool://expensive'), ctx())), 'allow');
  assert.equal(await decision(p.evaluate(act('tool.invoke', 'tool://expensive'), ctx())), 'allow');
  const exhausted = toVerdict(await p.evaluate(act('tool.invoke', 'tool://expensive'), ctx()));
  assert.equal(exhausted.decision, 'deny');
  assert.equal(exhausted.reason, 'limit limit:tool://expensive exhausted');
});

test('audit rules allow and record', async () => {
  const p = new RulePolicyEngine([auditCalls('env.*')]);
  assert.equal(await decision(p.evaluate(act('env.set', 'env://local/k'), ctx())), 'audit');
  const log = p.auditLog();
  assert.equal(log.length, 1);
  assert.equal(log[0]!.target, 'env://local/k');
});

test('requireGrants denies ungranted permission requests', async () => {
  const p = new RulePolicyEngine([requireGrants()]);
  assert.equal(await decision(p.evaluate(act('env.set', 'env://x', ['fs.write']), ctx([]))), 'deny');
  assert.equal(await decision(p.evaluate(act('env.set', 'env://x', ['fs.write']), ctx(['fs.write']))), 'allow');
});

test('default decision applies when nothing matches', async () => {
  const p = new RulePolicyEngine([denyCapability('nothing.matches')], { default: 'require_approval' });
  assert.equal(await decision(p.evaluate(act('env.get', 'env://x'), ctx())), 'require_approval');
});

test('allOf propagates the strictest engine and its reason', async () => {
  const lax = new RulePolicyEngine([requireApproval('env.*')]);
  const strict = new RulePolicyEngine([denyCapability('env.delete', { id: 'hard-no' })]);
  const v = toVerdict(await allOf(lax, strict).evaluate(act('env.delete', 'env://x'), ctx()));
  assert.equal(v.decision, 'deny');
  assert.equal(v.reason, 'rule hard-no');
});
