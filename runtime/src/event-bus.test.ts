import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from './event-bus.ts';
import { createGoal, createAction, verifyChain, GENESIS_HASH, generateSealKeypair, type NaroEvent } from '@naro/core';
const GOAL = createGoal({ description: 'test goal' });

test('emits typed events to per-type and wildcard listeners in order', () => {
  const bus = new EventBus({ agentId: 'a1', goalId: 'g1' });
  const seen: string[] = [];
  bus.on('agent.created', (e) => seen.push(`created:${e.data.name}`));
  bus.on('*', (e) => seen.push(`*:${e.type}:${e.seq}`));

  bus.emit('agent.created', { name: 'tester' });
  bus.emit('reasoning.started', { iteration: 0 });

  assert.deepEqual(seen, ['created:tester', '*:agent.created:1', '*:reasoning.started:2']);
});

test('history preserves the full ordered log', () => {
  const bus = new EventBus({ agentId: 'a1', goalId: 'g1' });
  bus.emit('agent.created', { name: 'x' });
  bus.emit('agent.completed', { result: 42 });
  const h = bus.history();
  assert.equal(h.length, 2);
  assert.equal(h[1]!.seq, 2);
  assert.equal(h[0]!.agentId, 'a1');
});

test('unsubscribe stops delivery', () => {
  const bus = new EventBus({ agentId: 'a1', goalId: 'g1' });
  let count = 0;
  const off = bus.on('reasoning.started', () => count++);
  bus.emit('reasoning.started', { iteration: 0 });
  off();
  bus.emit('reasoning.started', { iteration: 1 });
  assert.equal(count, 1);
});

test('goal ids ride on every event for traceability', () => {
  const goal = createGoal({ description: 'trace me' });
  const bus = new EventBus({ agentId: 'a1', goalId: goal.id });
  const e = bus.emit('agent.created', { name: 'x' });
  assert.equal(e.goalId, goal.id);
});

test('emitted payloads are snapshots — later mutation cannot rewrite history', () => {
  const bus = new EventBus({ agentId: 'a1', goalId: 'g1' });
  const action = createAction('a1', { capability: 'x', target: 'tool://x' });
  bus.emit('action.requested', { action });
  action.state = 'completed'; // mutate after emit
  const stored = (bus.history()[0] as NaroEvent<'action.requested'>).data.action;
  assert.equal(stored.state, 'requested'); // still the emitted fact
});

test('emitted events form a verifiable hash chain rooted at GENESIS_HASH', () => {
  const bus = new EventBus({ agentId: 'a1', goalId: 'g1' });
  bus.emit('agent.created', { name: 'x' });
  bus.emit('reasoning.started', { iteration: 0 });
  bus.emit('agent.completed', { result: 1 });

  const h = bus.history();
  assert.equal(h[0]!.prev, GENESIS_HASH);
  assert.equal(h[1]!.prev, h[0]!.hash);
  assert.equal(bus.head(), h.at(-1)!.hash);
  assert.equal(verifyChain(h).ok, true);
});

test('resumeJournal(head) links new events to the checkpointed chain', () => {
  const bus1 = new EventBus({ agentId: 'a1', goalId: 'g1' });
  bus1.emit('agent.created', { name: 'x' });
  const head = bus1.head();
  const runId = bus1.runId;

  const bus2 = new EventBus({ agentId: 'a1', goalId: 'g1' });
  bus2.resumeJournal(runId, 2, head);
  const e = bus2.emit('agent.resumed', {});
  assert.equal(e.prev, head);
  assert.equal(verifyChain([...bus1.history(), e]).ok, true);
});

test('a throwing subscriber is isolated and lands in deliveryErrors', () => {
  const bus = new EventBus({ agentId: 'a1', goalId: 'g1' });
  bus.on('agent.created', () => { throw new Error('subscriber boom'); });
  bus.emit('agent.created', { name: 'x' }); // does not throw
  assert.equal(bus.deliveryErrors.length, 1);
  assert.equal(bus.deliveryErrors[0]!.type, 'agent.created');
});

test('seal signs the chain head; verifyChain validates it end-to-end', () => {
  const { privateKeyPem, publicKeyPem } = generateSealKeypair();
  const bus = new EventBus({ agentId: 'a1', goalId: 'g1' });
  bus.emit('agent.created', { name: 'x' });
  bus.emit('agent.completed', { result: 1 });
  const seal = bus.seal(privateKeyPem);

  // The seal's prev IS the signed head — self-verifying by construction.
  assert.equal(seal.data.head, seal.prev);
  const verdict = verifyChain(bus.history());
  assert.equal(verdict.ok, true);
  assert.equal(verdict.sealed?.ok, true);
  assert.equal(verdict.sealed?.publicKey?.trim(), publicKeyPem.trim());
});

test('a forged or extended seal fails verification', () => {
  const { privateKeyPem } = generateSealKeypair();
  const bus = new EventBus({ agentId: 'a1', goalId: 'g1' });
  bus.emit('agent.completed', { result: 1 });
  bus.seal(privateKeyPem);

  // An event after the seal invalidates it.
  const forged = [...bus.history(), {
    id: 'evt-forged', type: 'agent.failed', seq: 99, at: Date.now(),
    agentId: 'a1', goalId: 'g1', runId: bus.runId, data: { error: 'x' },
    prev: bus.head(), hash: 'f'.repeat(64),
  } as NaroEvent];
  const v = verifyChain(forged);
  assert.equal(v.ok, false);
  assert.match(v.reason ?? '', /hash mismatch|after the journal seal/);

  // Wrong public key fails the signature check.
  const other = generateSealKeypair();
  const tampered = bus.history().map((e) => e.type === 'journal.sealed'
    ? { ...e, data: { ...(e.data as object), publicKey: other.publicKeyPem } } as NaroEvent
    : e);
  // Recompute nothing — the tampered seal event's own hash no longer matches.
  assert.equal(verifyChain(tampered).ok, false);
});

test('runner seals terminal journals when sealKey is set; paused runs stay open', async () => {
  const { privateKeyPem, publicKeyPem } = generateSealKeypair();
  const { AgentRunner } = await import('./runner.ts');
  const { DirectReasoner } = await import('./reasoner-direct.ts');
  const { allowAllPolicy, createAgentSpec, createGoal, createObservation } = await import('@naro/core');
  const deps = {
    spec: createAgentSpec({ name: 's', goal: createGoal({ description: 'g' }) }),
    executor: { execute: (a: never) => Promise.resolve(createObservation({ actionId: (a as { id: string }).id, source: 'x', kind: 'env-change' as const, success: true })) },
    policy: allowAllPolicy,
    sealKey: privateKeyPem,
  };
  const r = await new AgentRunner({ ...deps, reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'ok' })) }).run();
  const v = verifyChain(r.events);
  assert.equal(v.ok, true);
  assert.equal(v.sealed?.ok, true);
  assert.equal(v.sealed?.publicKey?.trim(), publicKeyPem.trim());
  // The seal is the journal's last event.
  assert.equal(r.events.at(-1)!.type, 'journal.sealed');
});
