import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowAllPolicy, createAgentSpec, createGoal, createObservation, verifyChain, generateSealKeypair,
  type ActionExecutor, type EventType, type NaroEvent,
} from '@naro/core';

type NaroEventOf<T extends EventType> = NaroEvent<T>;
import { AgentRunner } from './runner.ts';
import { DirectReasoner } from './reasoner-direct.ts';
import { recoverSession } from './session.ts';

const echoExecutor: ActionExecutor = {
  execute: (action) => Promise.resolve(createObservation({
    actionId: action.id, source: action.target, kind: 'env-change',
    success: true, output: action.input,
  })),
};

// One spec per test wiring: wake() filters the journal by spec.id, so the
// two runners must share the same agent identity — same as a real redeploy.
const deps = (() => {
  const shared = {
    spec: createAgentSpec({ name: 'tester', goal: createGoal({ description: 'test goal' }) }),
    executor: echoExecutor,
    policy: allowAllPolicy,
  };
  return () => shared;
})();

test('wake(runId) continues a run from its journal alone — no checkpoint', async () => {
  const reasoner1 = new DirectReasoner(() =>
    ({ kind: 'act', action: { capability: 'env.set', target: 'env://local/k', input: 'step1' } }));
  const runner1 = new AgentRunner({ ...deps(), reasoner: reasoner1 });
  runner1.on('action.completed', () => runner1.pause());
  const r1 = await runner1.run();
  assert.equal(r1.status, 'paused');

  // A second process with no checkpoint store — the journal is enough.
  const reasoner2 = new DirectReasoner((ctx) =>
    ctx.observations.length >= 1
      ? { kind: 'complete', result: 'woken' }
      : { kind: 'fail', reason: 'journal did not rebuild observations' });
  const runner2 = new AgentRunner({ ...deps(), reasoner: reasoner2 });
  const r2 = await runner2.wake(r1.events);

  assert.equal(r2.status, 'completed');
  assert.equal(r2.result, 'woken');
  assert.ok(r2.events.some((e) => e.type === 'agent.resumed'));

  // One continuous chain across the process boundary.
  const all = [...r1.events, ...r2.events];
  assert.ok(all.every((e) => e.runId === r1.events[0]!.runId));
  const verdict = verifyChain(all);
  assert.equal(verdict.ok, true, verdict.reason ?? 'chain intact');
});

test('wake accepts any JournalSource — history() shape, not a class', async () => {
  const runner1 = new AgentRunner({
    ...deps(),
    reasoner: new DirectReasoner(() => ({ kind: 'act', action: { capability: 'env.set', target: 'env://local/k', input: 1 } })),
  });
  runner1.on('action.completed', () => runner1.pause());
  const r1 = await runner1.run();

  const store = { history: () => Promise.resolve(r1.events) };
  const runner2 = new AgentRunner({
    ...deps(),
    reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'ok' })),
  });
  const r2 = await runner2.wake(store, r1.events[0]!.runId);
  assert.equal(r2.status, 'completed');
});

test('compact() stores the summary as an event and shrinks live evidence', async () => {
  const runner = new AgentRunner({
    ...deps(),
    reasoner: new DirectReasoner((ctx) =>
      ctx.observations.length === 0
        ? { kind: 'act', action: { capability: 'env.set', target: 'env://local/k', input: 'v' } }
        : { kind: 'complete', result: 'done' }),
  });
  runner.on('observation.created', () => {
    // Compact once, right after the first observation lands.
    runner.compact('set k = v succeeded', { keepObservations: 0 });
  });
  const r = await runner.run();
  assert.equal(r.status, 'completed');
  const compacted = r.events.find((e) => e.type === 'session.compacted');
  assert.ok(compacted, 'session.compacted emitted');
  assert.equal((compacted as NaroEventOf<'session.compacted'>).data.summary, 'set k = v succeeded');
});

test('wake honors session.compacted: old observations collapse to the summary', async () => {
  const runner1 = new AgentRunner({
    ...deps(),
    reasoner: new DirectReasoner(() => ({ kind: 'act', action: { capability: 'env.set', target: 'env://local/k', input: 'v' } })),
  });
  runner1.on('observation.created', () => {
    runner1.compact('step one wrote v to k');
    runner1.pause();
  });
  const r1 = await runner1.run();
  assert.equal(r1.status, 'paused');

  const s = recoverSession(r1.events);
  // The original env-change observation is gone; the summary leads.
  assert.equal(s.observations[0]!.source, 'session');
  assert.match(String(s.observations[0]!.output), /step one wrote v to k/);
  assert.equal(s.observations.length, 1);
  assert.ok(s.compaction);
});

test('recoverSession replays an interrupted iteration (at-least-once)', async () => {
  const runner = new AgentRunner({
    ...deps(),
    reasoner: new DirectReasoner(() => ({ kind: 'act', action: { capability: 'env.set', target: 'env://local/k', input: 1 } })),
  });
  runner.on('action.completed', () => runner.pause());
  const r = await runner.run();
  const s = recoverSession(r.events);
  // Iteration 0 completed; resume starts iteration 1.
  const lastCompleted = r.events.filter((e) => e.type === 'reasoning.completed').at(-1);
  assert.equal(s.iteration, (lastCompleted!.data as { iteration: number }).iteration + 1);
  assert.ok(s.actions.length >= 1);
  assert.ok(s.observations.length >= 1);

  // A crash mid-decision: reasoning.started(7) with no completed — replay it.
  const interrupt = {
    id: 'evt-x', type: 'reasoning.started', seq: 999, at: Date.now(),
    agentId: r.events[0]!.agentId, goalId: r.events[0]!.goalId,
    runId: r.events[0]!.runId, data: { iteration: 7 },
  } as unknown as NaroEvent;
  assert.equal(recoverSession([...r.events, interrupt]).iteration, 7);
});

test('wake refuses a sealed journal — the seal is a signature over finality', async () => {
  const { privateKeyPem } = generateSealKeypair();
  const runner1 = new AgentRunner({
    ...deps(), sealKey: privateKeyPem,
    reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'done' })),
  });
  const r1 = await runner1.run();
  assert.equal(r1.events.at(-1)!.type, 'journal.sealed');

  const runner2 = new AgentRunner({
    ...deps(),
    reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'x' })),
  });
  await assert.rejects(() => runner2.wake(r1.events), /sealed/);
});
