import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowAllPolicy, createAgentSpec, createGoal, createObservation,
  type ActionExecutor, type PolicyEngine, type Verifier,
} from '@naro/core';
import { AgentRunner, DirectReasoner, type HumanBridge } from '@naro/runtime';
import { buildEvidence, formatEvidence } from './evidence.ts';

const echo: ActionExecutor = {
  execute: (a) => Promise.resolve(createObservation({ actionId: a.id, source: a.target, kind: 'env-change', success: true })),
};

const spec = () => createAgentSpec({ goal: createGoal({ description: 'm' }) });

const actThenComplete = new DirectReasoner((ctx) =>
  ctx.observations.length === 0
    ? { kind: 'act', action: { capability: 'env.set', target: 'env://local/k', input: 1 } }
    : { kind: 'complete', result: 'done' });

test('a clean run yields a chained record: permitted → observed → completed', async () => {
  const runner = new AgentRunner({ spec: spec(), reasoner: actThenComplete, executor: echo, policy: allowAllPolicy });
  const { events } = await runner.run();
  const rec = buildEvidence(events);

  assert.equal(rec.chain.ok, true, rec.chain.reason ?? 'chain verification failed');
  assert.equal(rec.outcome?.status, 'completed');
  assert.equal(rec.counts.actions, 1);
  const a = rec.actions[0]!;
  assert.equal(a.policy, 'permitted');
  assert.equal(a.executed, true);
  assert.equal(a.observation?.success, true);
});

test('verifier identity lands on both action and goal evidence', async () => {
  const verifier: Verifier = { id: 'test-verifier', verify: () => ({ ok: true }) };
  const runner = new AgentRunner({
    spec: spec(), reasoner: actThenComplete, executor: echo, policy: allowAllPolicy, verifier,
  });
  const rec = buildEvidence((await runner.run()).events);

  assert.equal(rec.actions[0]!.verification?.ok, true);
  assert.equal(rec.actions[0]!.verification?.verifier, 'test-verifier');
  assert.equal(rec.goalVerification?.ok, true);
  assert.equal(rec.goalVerification?.verifier, 'test-verifier');
});

test('a denied action is evidence too: denied, never executed', async () => {
  const denyAll: PolicyEngine = { evaluate: () => 'deny' };
  const runner = new AgentRunner({ spec: spec(), reasoner: actThenComplete, executor: echo, policy: denyAll });
  const rec = buildEvidence((await runner.run()).events);

  const a = rec.actions[0]!;
  assert.equal(a.policy, 'denied');
  assert.equal(a.executed, false);
  assert.equal(a.observation, undefined);
  assert.equal(rec.counts.denied, 1);
});

test('approval-required action that a human approves reads as approved', async () => {
  const needsApproval: PolicyEngine = { evaluate: () => 'require_approval' };
  const human: HumanBridge = {
    approve: () => Promise.resolve({ approved: true }),
    ask: () => Promise.resolve(''),
  };
  const runner = new AgentRunner({
    spec: spec(), reasoner: actThenComplete, executor: echo, policy: needsApproval, human,
  });
  const rec = buildEvidence((await runner.run()).events);

  assert.equal(rec.actions[0]!.policy, 'approved');
  assert.equal(rec.actions[0]!.executed, true);
});

test('failed action verification is counted and attributed to the verifier', async () => {
  const failsOnce: Verifier = {
    id: 'strict',
    verify: (input) => input.observation !== undefined
      ? { ok: false, reason: 'not good enough' }
      : { ok: true },
  };
  const completesAfterReplan = new DirectReasoner((ctx) =>
    ctx.observations.length === 0
      ? { kind: 'act', action: { capability: 'env.set', target: 'env://local/k', input: 1 } }
      : { kind: 'complete', result: 'done' });
  const runner = new AgentRunner({
    spec: spec(), reasoner: completesAfterReplan, executor: echo, policy: allowAllPolicy, verifier: failsOnce,
  });
  const rec = buildEvidence((await runner.run()).events);

  assert.equal(rec.actions[0]!.verification?.ok, false);
  assert.equal(rec.actions[0]!.verification?.verifier, 'strict');
  assert.equal(rec.counts.verificationFailures, 1);
  assert.equal(rec.goalVerification?.ok, true); // goal-level verify still passed
});

test('tampered journal surfaces in the record, not silently', async () => {
  const runner = new AgentRunner({ spec: spec(), reasoner: actThenComplete, executor: echo, policy: allowAllPolicy });
  const { events } = await runner.run();
  const tampered = events.map((e, i) =>
    i === 2 ? ({ ...e, data: { injected: true } } as unknown as typeof e) : e);
  const rec = buildEvidence(tampered);

  assert.equal(rec.chain.ok, false);
  assert.match(rec.chain.reason ?? '', /hash mismatch|broken link/);
});

test('formatEvidence renders the chain verdict and per-action line', async () => {
  const runner = new AgentRunner({ spec: spec(), reasoner: actThenComplete, executor: echo, policy: allowAllPolicy });
  const rec = buildEvidence((await runner.run()).events);
  const text = formatEvidence(rec);

  assert.match(text, /chain: OK/);
  assert.match(text, /permitted → observed ok/);
  assert.match(text, /outcome: completed/);
});
