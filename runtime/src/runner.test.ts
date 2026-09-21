import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowAllPolicy, createAgentSpec, createGoal, createObservation, verifyChain,
  type ActionExecutor, type NaroEvent, type PolicyEngine, type Verifier,
} from '@naro/core';
import { AgentRunner } from './runner.ts';
import { ReActReasoner } from '@naro/reasoning';
import { MockModel } from '@naro/model';
import { DirectReasoner } from './reasoner-direct.ts';
import { InMemoryCheckpointStore } from './checkpoint.ts';

/** A test executor: echoes the action input back as an observation. */
const echoExecutor: ActionExecutor = {
  execute: (action) => Promise.resolve(createObservation({
    actionId: action.id, source: action.target, kind: 'env-change',
    success: true, output: action.input,
  })),
};

function wiring(overrides: Partial<Parameters<typeof AgentRunner.prototype.run>[0]> extends never ? object : object) {
  return overrides;
}

function makeDeps(extra: Record<string, unknown> = {}) {
  const goal = createGoal({ description: 'test goal', successCriteria: ['done'] });
  return {
    spec: createAgentSpec({ name: 'tester', goal }),
    executor: echoExecutor,
    policy: allowAllPolicy,
    ...extra,
  };
}

test('full loop: reason → act → observe → complete, all events emitted', async () => {
  const reasoner = new DirectReasoner((ctx) => {
    const acted = ctx.observations.some((o) => o.kind === 'env-change');
    return acted
      ? { kind: 'complete', result: ctx.observations.at(-1)?.output }
      : { kind: 'act', action: { capability: 'env.write', target: 'env://local/k', input: 'v' } };
  });
  const runner = new AgentRunner({ ...makeDeps(), reasoner });
  const result = await runner.run();

  assert.equal(result.status, 'completed');
  assert.equal(result.state, 'COMPLETED');
  assert.equal(result.result, 'v');

  const types = result.events.map((e) => e.type);
  for (const expected of [
    'agent.created', 'goal.started', 'reasoning.started', 'action.requested',
    'permission.requested', 'action.permitted', 'action.started',
    'action.completed', 'observation.created', 'agent.completed',
  ]) {
    assert.ok(types.includes(expected as never), `missing event ${expected}`);
  }
  // policy gate happened before execution
  assert.ok(types.indexOf('permission.requested') < types.indexOf('action.started'));
});

test('policy denial becomes an observation — the reasoner sees it and adapts', async () => {
  const denyWrites: PolicyEngine = {
    evaluate: (a) => (a.target.includes('env://') ? 'deny' : 'allow'),
  };
  let sawDenial = false;
  const reasoner = new DirectReasoner((ctx) => {
    const denied = ctx.observations.some((o) => o.error === 'action denied by policy');
    if (denied) { sawDenial = true; return { kind: 'complete', result: 'gave up gracefully' }; }
    return { kind: 'act', action: { capability: 'env.write', target: 'env://local/k', input: 'v' } };
  });
  const runner = new AgentRunner({ ...makeDeps(), reasoner, policy: denyWrites });
  const result = await runner.run();

  assert.equal(result.status, 'completed');
  assert.ok(sawDenial);
  assert.ok(result.events.some((e) => e.type === 'action.denied'));
});

test('require_approval routes through WAITING_FOR_HUMAN via the bridge', async () => {
  const gated: PolicyEngine = { evaluate: () => 'require_approval' };
  let asked = 0;
  const human = {
    approve: () => { asked++; return Promise.resolve({ approved: asked >= 2 }); },
    ask: () => Promise.resolve(''),
  };
  const reasoner = new DirectReasoner((ctx) => {
    if (ctx.observations.some((o) => o.kind === 'env-change')) return { kind: 'complete', result: 'ok' };
    if (ctx.observations.some((o) => o.kind === 'human')) {
      // first approval refused → reasoner retries once
      return { kind: 'act', action: { capability: 'env.write', target: 'env://local/k', input: 'v' } };
    }
    return { kind: 'act', action: { capability: 'env.write', target: 'env://local/k', input: 'v' } };
  });
  const runner = new AgentRunner({ ...makeDeps(), reasoner, policy: gated, human });
  const result = await runner.run();
  assert.equal(result.status, 'completed');
  assert.equal(asked, 2);
  assert.ok(result.events.some((e) => e.type === 'human.approval.requested'));
});

test('tool failure surfaces as an error observation, not a crash', async () => {
  const failing: ActionExecutor = {
    execute: () => Promise.reject(new Error('tool exploded')),
  };
  const reasoner = new DirectReasoner((ctx) =>
    ctx.observations.some((o) => o.kind === 'error')
      ? { kind: 'complete', result: 'handled' }
      : { kind: 'act', action: { capability: 'tool.invoke', target: 'tool://x', input: {} } });
  const runner = new AgentRunner({ ...makeDeps(), reasoner, executor: failing });
  const result = await runner.run();
  assert.equal(result.status, 'completed');
});

test('failed verification triggers replan, then success completes', async () => {
  let verifyCalls = 0;
  const verifier: Verifier = {
    id: 'flaky-verifier',
    verify: () => { verifyCalls++; return Promise.resolve({ ok: verifyCalls >= 2, reason: 'not yet' }); },
  };
  const reasoner = new DirectReasoner((ctx) => {
    if (verifyCalls >= 2) return { kind: 'complete', result: 'verified' };
    return { kind: 'act', action: { capability: 'env.write', target: 'env://local/k', input: 'v' } };
  });
  const runner = new AgentRunner({ ...makeDeps(), reasoner, verifier });
  const result = await runner.run();
  assert.equal(result.status, 'completed');
  assert.ok(result.events.some((e) => e.type === 'replan.triggered'));
});

test('abort signal cancels the run at the next boundary', async () => {
  const ac = new AbortController();
  const reasoner = new DirectReasoner(() => {
    ac.abort('stop');
    return { kind: 'act', action: { capability: 'env.write', target: 'env://local/k' } };
  });
  const runner = new AgentRunner({ ...makeDeps(), reasoner });
  const result = await runner.run({ signal: ac.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.state, 'CANCELLED');
});

test('pause → checkpoint → a fresh runner resumes with full history', async () => {
  const store = new InMemoryCheckpointStore();
  const deps = makeDeps();
  let paused = false;

  const reasoner1 = new DirectReasoner((ctx) => {
    if (!paused && ctx.iteration >= 1) { paused = true; return { kind: 'act', action: { capability: 'env.write', target: 'env://local/k', input: 'step1' } }; }
    return { kind: 'act', action: { capability: 'env.write', target: 'env://local/k', input: 'step1' } };
  });

  const runner1 = new AgentRunner({ ...deps, reasoner: reasoner1, checkpoints: store });
  // pause after the first completed cycle
  runner1.on('action.completed', () => runner1.pause());
  const r1 = await runner1.run();
  assert.equal(r1.status, 'paused');

  const saved = await store.latest(deps.spec.id);
  assert.ok(saved, 'checkpoint should exist');
  assert.ok(saved.data.observations.length >= 1);

  // simulate crash: a brand-new runner resumes from the checkpoint
  const reasoner2 = new DirectReasoner((ctx) =>
    ctx.observations.length >= 1
      ? { kind: 'complete', result: 'resumed-and-done' }
      : { kind: 'fail', reason: 'lost state' });
  const runner2 = new AgentRunner({ ...deps, reasoner: reasoner2, checkpoints: store });
  const r2 = await runner2.run({ resume: true });

  assert.equal(r2.status, 'completed');
  assert.equal(r2.result, 'resumed-and-done');
  assert.ok(r2.events.some((e) => e.type === 'agent.resumed'));
});

test('pause + resume produces one continuous hash-chained journal', async () => {
  const store = new InMemoryCheckpointStore();
  const deps = makeDeps();

  const reasoner1 = new DirectReasoner((ctx) =>
    ({ kind: 'act', action: { capability: 'env.write', target: 'env://local/k', input: 'step1' } }));
  const runner1 = new AgentRunner({ ...deps, reasoner: reasoner1, checkpoints: store });
  runner1.on('action.completed', () => runner1.pause());
  const r1 = await runner1.run();
  assert.equal(r1.status, 'paused');

  const reasoner2 = new DirectReasoner((ctx) =>
    ctx.observations.length >= 1
      ? { kind: 'complete', result: 'resumed' }
      : { kind: 'fail', reason: 'lost state' });
  const runner2 = new AgentRunner({ ...deps, reasoner: reasoner2, checkpoints: store });
  const r2 = await runner2.run({ resume: true });
  assert.equal(r2.status, 'completed');

  const all = [...r1.events, ...r2.events];
  assert.ok(all.every((e) => e.runId === all[0]!.runId), 'one runId across resume');
  const verdict = verifyChain(all);
  assert.equal(verdict.ok, true, verdict.reason ?? 'chain intact');
});

test('goal verification.completed names the verifier', async () => {
  const verifier: Verifier = { id: 'goal-checker', verify: () => Promise.resolve({ ok: true }) };
  const runner = new AgentRunner({
    ...makeDeps(), verifier,
    reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'done' })),
  });
  const r = await runner.run();
  const vc = r.events.find((e) => e.type === 'verification.completed');
  assert.equal((vc as NaroEvent<'verification.completed'>).data.verifier, 'goal-checker');
});

test('external evidence lowers ctx.provenance at the next gate', async () => {
  const externalExec: ActionExecutor = {
    execute: (action) => Promise.resolve(createObservation({
      actionId: action.id, source: 'env://web', kind: 'env-change',
      success: true, output: 'a web page', trust: 'external',
    })),
  };
  const seen: ({ lowest?: string; externalSources?: readonly string[] } | undefined)[] = [];
  const spy: PolicyEngine = {
    evaluate: (action, ctx) => { seen.push(ctx.provenance); return 'allow'; },
  };
  // iteration 3: after two actions, complete so the run ends
  let calls = 0;
  const counting = new DirectReasoner((ctx) => {
    calls++;
    if (calls >= 3) return { kind: 'complete', result: 'done' };
    return ctx.observations.some((o) => o.kind === 'env-change')
      ? { kind: 'act', action: { capability: 'env.write', target: 'env://local/k', input: 'done' } }
      : { kind: 'act', action: { capability: 'env.read', target: 'env://web', input: '' } };
  });
  const runner = new AgentRunner({ ...makeDeps(), executor: externalExec, policy: spy, reasoner: counting });
  const r = await runner.run();
  assert.equal(r.status, 'completed');
  // Gate 1 saw no prior evidence; gate 2 saw iteration 1's external obs.
  assert.equal(seen[0]?.lowest, 'system');
  assert.equal(seen[1]?.lowest, 'external');
  assert.deepEqual(seen[1]?.externalSources, ['env://web']);
});

test('iteration limit fails the run instead of looping forever', async () => {
  const reasoner = new DirectReasoner(() =>
    ({ kind: 'act', action: { capability: 'env.write', target: 'env://local/k' } }));
  const runner = new AgentRunner({ ...makeDeps(), reasoner, maxIterations: 3 });
  const result = await runner.run();
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /iteration limit/);
});

test('need-context decisions route through WAITING_FOR_CONTEXT', async () => {
  const context = { retrieve: () => Promise.resolve([{ id: 'c1', source: 'test', content: 'fact' }]) };
  const reasoner = new DirectReasoner((ctx) =>
    ctx.context.length === 0
      ? { kind: 'need-context', query: 'what is the answer' }
      : { kind: 'complete', result: ctx.context[0]!.content });
  const runner = new AgentRunner({ ...makeDeps(), reasoner, context });
  const result = await runner.run();
  assert.equal(result.result, 'fact');
  assert.ok(result.events.some((e) => e.type === 'context.retrieved'));
});

// ── live event streaming ─────────────────────────────────────────────
test('events() streams live and closes at terminal event', async () => {
  const runner = new AgentRunner({
    ...makeDeps(),
    reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'done' })),
  });
  const seen: string[] = [];
  const consume = (async () => {
    for await (const e of runner.events()) seen.push(e.type);
  })();
  await runner.run();
  await consume;
  assert.ok(seen.includes('agent.created'));
  assert.ok(seen.includes('reasoning.started'));
  assert.equal(seen.at(-1), 'agent.completed');
});

test('events() seeded with history — a late subscriber sees the whole run', async () => {
  const runner = new AgentRunner({
    ...makeDeps(),
    reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'done' })),
  });
  await runner.run();
  const seen: string[] = [];
  for await (const e of runner.events()) seen.push(e.type);
  assert.equal(seen[0], 'agent.created');
  assert.equal(seen.at(-1), 'agent.completed');
});

test('action timeout aborts the executor — the signal reaches it', async () => {
  let sawAbort = false;
  const slowExecutor: ActionExecutor = {
    execute: (action, ctx) => new Promise((resolve, reject) => {
      ctx.signal?.addEventListener('abort', () => { sawAbort = true; reject(ctx.signal!.reason); }, { once: true });
      setTimeout(() => resolve(createObservation({ actionId: action.id, source: 'x', kind: 'env-change', success: true })), 10_000);
    }),
  };
  const runner = new AgentRunner({
    ...makeDeps(),
    executor: slowExecutor,
    actionTimeoutMs: 20,
    reasoner: new DirectReasoner((ctx) => ctx.observations.length
      ? { kind: 'complete', result: 'done' }
      : { kind: 'act', action: { capability: 'x', target: 'env://e/x' } }),
  });
  const r = await runner.run();
  assert.equal(r.status, 'completed');
  assert.equal(sawAbort, true); // the timeout ABORTED, not just stopped waiting
});

test('failed action verification records an observation naming the verifier', async () => {
  const verifier: Verifier = { id: 'test-verifier', verify: () => ({ ok: false, reason: 'not good enough' }) };
  const runner = new AgentRunner({
    ...makeDeps(),
    verifier,
    reasoner: new DirectReasoner((ctx) => ctx.observations.some((o) => o.kind === 'verification')
      ? { kind: 'complete', result: 'accepted-anyway' }
      : { kind: 'act', action: { capability: 'x', target: 'env://e/x' } }),
  });
  const r = await runner.run();
  const vobs = r.events.filter((e) => e.type === 'observation.created')
    .map((e) => (e as NaroEvent<'observation.created'>).data.observation)
    .find((o) => o.kind === 'verification');
  assert.ok(vobs, 'verification failure must be visible to the reasoner');
  assert.match(vobs!.source, /test-verifier/);
  assert.match(vobs!.error ?? '', /not good enough/);
});

test('resume restores reasoner state and continues the event journal', async () => {
  const store = new InMemoryCheckpointStore();
  let decided = 0;
  const stateful = () => {
    const r = new DirectReasoner((ctx) => ctx.iteration === 0
      ? { kind: 'act', action: { capability: 'x', target: 'env://e/x' } }
      : { kind: 'complete', result: 'done' });
    const orig = r.decide.bind(r);
    const s = {
      strategy: 'stateful',
      calls: 0,
      decide: (ctx: Parameters<typeof orig>[0]) => { s.calls++; return orig(ctx); },
      captureState: () => ({ calls: s.calls }),
      restoreState: (v: unknown) => { s.calls = (v as { calls: number }).calls; },
    };
    return s;
  };
  const r1 = new AgentRunner({ ...makeDeps(), checkpoints: store, reasoner: stateful() });
  r1.pause(); // pause before first boundary
  await r1.run();
  const first = r1.events; // capture? use bus history via run result
  const res1 = await r1.run({ resume: true });
  // A second runner sharing the store: runId + seq continue, not restart
  const r2 = new AgentRunner({ ...makeDeps(), checkpoints: store, reasoner: stateful() });
  const res2 = await r2.run({ resume: true });
  const evs = res2.events;
  assert.ok(evs.every((e) => e.runId === evs[0]!.runId));
  const seqs = evs.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
});

test('act-batch: gated serially, executed concurrently, each observed', async () => {
  let concurrent = 0; let maxConcurrent = 0;
  const slowExec: ActionExecutor = {
    execute: (action) => new Promise((resolve) => {
      concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
      setTimeout(() => {
        concurrent--;
        resolve(createObservation({
          actionId: action.id, source: action.target, kind: 'env-change',
          success: true, output: action.target,
        }));
      }, 30);
    }),
  };
  const runner = new AgentRunner({
    ...makeDeps(),
    executor: slowExec,
    reasoner: new DirectReasoner((ctx) => ctx.observations.length >= 2
      ? { kind: 'complete', result: 'both' }
      : { kind: 'act-batch', actions: [
          { capability: 'x', target: 'env://e/1' },
          { capability: 'x', target: 'env://e/2' },
          { capability: 'x', target: 'env://e/3' },
        ] }),
  });
  const r = await runner.run();
  assert.equal(r.status, 'completed');
  assert.ok(maxConcurrent > 1, `expected overlap, got max ${maxConcurrent}`);
  const obs = r.events.filter((e) => e.type === 'observation.created');
  assert.equal(obs.length, 3);
});

test('model.usage events accumulate; totals land on agent.completed', async () => {
  const events: string[] = [];
  const goal = createGoal({ description: 't' });
  const model = new MockModel({ responses: [
    { message: { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'x', arguments: {} }] },
      finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5 } },
    { message: { role: 'assistant', content: 'done' },
      finishReason: 'stop', usage: { inputTokens: 8, outputTokens: 4 } },
  ]});
  const runner = new AgentRunner({
    spec: createAgentSpec({ name: 't', goal }),
    reasoner: new ReActReasoner(model),
    executor: echoExecutor,
    policy: allowAllPolicy,
  });
  runner.on('model.usage', (e) => events.push(e.type));
  const res = await runner.run();
  assert.equal(res.status, 'completed');
  assert.equal(events.length, 2);
  const done = res.events.find((e) => e.type === 'agent.completed');
  assert.deepEqual(done?.data.usage, { inputTokens: 18, outputTokens: 9, totalTokens: 27, costUsd: 0 });
});

test('token budget fails the run fast when usage crosses the cap', async () => {
  const goal = createGoal({ description: 'budget' });
  const model = new MockModel({ responses: [
    { message: { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'x', arguments: {} }] },
      finishReason: 'tool-calls', usage: { inputTokens: 100, outputTokens: 50 } },
    { message: { role: 'assistant', content: 'never reached' }, finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 } },
  ]});
  const runner = new AgentRunner({
    spec: createAgentSpec({ name: 't', goal }),
    reasoner: new ReActReasoner(model),
    executor: echoExecutor,
    policy: allowAllPolicy,
    budgets: { maxTotalTokens: 100 },
  });
  const res = await runner.run();
  assert.equal(res.status, 'failed');
  assert.match(res.error!, /token budget 100 exceeded \(150\)/);
  // the second model call never happened — budget stopped the loop
  assert.equal(res.events.filter((e) => e.type === 'model.usage').length, 1);
});
