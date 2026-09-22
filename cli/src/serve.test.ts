import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowAllPolicy, createAgentSpec, createObservation, type Goal, type NaroEvent } from '@naro/core';
import { AgentRunner, DirectReasoner, SqliteApprovalBridge, SqliteRunRegistry } from '@naro/runtime';
import { SqliteEventStore } from '@naro/observability';
import { startAgentServer } from './serve.ts';

const factory = (goal: Goal) => new AgentRunner({
  spec: createAgentSpec({ name: 'svc', goal }),
  reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'done' })),
  executor: { execute: (a) => Promise.resolve(createObservation({ actionId: a.id, source: a.target, kind: 'env-change', success: true })) },
  policy: allowAllPolicy,
});

test('goals → runs → result round-trip over HTTP', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0 });
  try {
    const created = await fetch(`${url}/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'test goal' }),
    });
    assert.equal(created.status, 202);
    const { runId } = await created.json() as { runId: string };
    await new Promise((r) => setTimeout(r, 50));
    const run = await (await fetch(`${url}/runs/${runId}`)).json() as { status: string; result?: string };
    assert.equal(run.status, 'completed');
    assert.equal(run.result, 'done');
  } finally {
    await close();
  }
});

test('/ready reflects the probe and the drain state', async () => {
  let ready = true;
  const { url, close } = await startAgentServer(factory, { port: 0, ready: () => ready });
  assert.equal((await fetch(`${url}/ready`)).status, 200);
  ready = false;
  assert.equal((await fetch(`${url}/ready`)).status, 503);
  await close(); // drain resolves even with the probe down
});

test('bearer token gates everything except probes', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0, token: 'tok' });
  try {
    assert.equal((await fetch(`${url}/health`)).status, 200); // probe: no auth
    assert.equal((await fetch(`${url}/runs`)).status, 401);
    assert.equal((await fetch(`${url}/runs`, { headers: { authorization: 'Bearer tok' } })).status, 200);
    const denied = await fetch(`${url}/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'x' }),
    });
    assert.equal(denied.status, 401);
  } finally {
    await close();
  }
});

test('oversized goal bodies are refused with 413', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0, maxBodyBytes: 64 });
  try {
    const res = await fetch(`${url}/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'x'.repeat(500) }),
    });
    assert.equal(res.status, 413);
  } finally {
    await close();
  }
});

test('the API runId IS the journal runId — events correlate with the returned id', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0 });
  const res = await fetch(`${url}/goals`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'correlate me' }),
  });
  const { runId } = await res.json() as { runId: string };
  await new Promise((r) => setTimeout(r, 50));
  const sse = await fetch(`${url}/runs/${runId}/events`);
  const text = await sse.text();
  const first = JSON.parse(text.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as { runId: string };
  assert.equal(first.runId, runId);
  await close();
});

test('idempotencyKey dedupes submissions — a retry returns the same run', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0 });
  const post = () => fetch(`${url}/goals`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'once', idempotencyKey: 'req-42' }),
  }).then((r) => r.json() as Promise<{ runId: string; deduplicated?: boolean }>);
  const a = await post();
  const b = await post(); // the retry
  assert.equal(b.runId, a.runId);
  assert.equal(b.deduplicated, true);
  const runs = await (await fetch(`${url}/runs`)).json() as unknown[];
  assert.equal(runs.length, 1); // one run, not two
  await close();
});

test('registry + journal survive a replica restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-serve-'));
  try {
    const registryPath = join(dir, 'runs.db');
    const journalPath = join(dir, 'events.db');

    // Replica A: journal its runs to a shared event store.
    const storeA = new SqliteEventStore(journalPath);
    const factoryA = (goal: Goal) => {
      const r = factory(goal);
      r.on('*', (e) => { void storeA.export([e]); });
      return r;
    };
    const a = await startAgentServer(factoryA, { port: 0, registry: new SqliteRunRegistry(registryPath) });
    const created = await fetch(`${a.url}/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'outlive me' }),
    });
    const { runId } = await created.json() as { runId: string };
    await new Promise((r) => setTimeout(r, 50));
    await storeA.flush();
    storeA.close();
    await a.close();

    // Replica B: same registry + journal, no local run handles.
    const journal = new SqliteEventStore(journalPath);
    const b = await startAgentServer(factory, { port: 0, registry: new SqliteRunRegistry(registryPath), journal });
    try {
      const runs = await (await fetch(`${b.url}/runs`)).json() as { runId: string; status: string; goal: string; host?: string }[];
      const mine = runs.find((r) => r.runId === runId);
      assert.equal(mine?.status, 'completed');
      assert.equal(mine?.goal, 'outlive me');
      assert.ok(mine?.host, 'host recorded');

      const one = await fetch(`${b.url}/runs/${runId}`);
      assert.equal(one.status, 200);
      assert.equal((await one.json() as { status: string }).status, 'completed');

      // Events for a run this replica doesn't own replay from the journal.
      const sse = await (await fetch(`${b.url}/runs/${runId}/events`)).text();
      const replayed = sse.split('\n').filter((l) => l.startsWith('data: '))
        .map((l) => JSON.parse(l.slice(6)) as NaroEvent);
      assert.equal(replayed.at(-1)!.type, 'agent.completed');

      // No journal → cross-replica events are a clear 404, not silence.
      const c = await startAgentServer(factory, { port: 0, registry: new SqliteRunRegistry(registryPath) });
      try {
        const res = await fetch(`${c.url}/runs/${runId}/events`);
        assert.equal(res.status, 404);
        assert.match((await res.json() as { error: string }).error, /cross-replica/);
      } finally { await c.close(); }
    } finally {
      journal.close();
      await b.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('idempotent submissions dedupe across replicas via the registry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-serve-'));
  try {
    const registryPath = join(dir, 'runs.db');
    const a = await startAgentServer(factory, { port: 0, registry: new SqliteRunRegistry(registryPath) });
    const res = await fetch(`${a.url}/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'x', idempotencyKey: 'dup-1' }),
    });
    const { runId } = await res.json() as { runId: string };
    await new Promise((r) => setTimeout(r, 50));
    await a.close();

    const b = await startAgentServer(factory, { port: 0, registry: new SqliteRunRegistry(registryPath) });
    try {
      const retry = await fetch(`${b.url}/goals`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'x', idempotencyKey: 'dup-1' }),
      });
      const again = await retry.json() as { runId: string; deduplicated?: boolean; status: string };
      assert.equal(again.runId, runId);
      assert.equal(again.deduplicated, true);
      assert.equal(again.status, 'completed');
    } finally { await b.close(); }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('/approvals: 501 without a bridge; full approve flow with one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-serve-'));
  try {
    // Not configured → 501.
    const none = await startAgentServer(factory, { port: 0 });
    try {
      assert.equal((await fetch(`${none.url}/approvals`)).status, 501);
      const post = await fetch(`${none.url}/approvals/x`, { method: 'POST', body: '{}' });
      assert.equal(post.status, 501);
    } finally { await none.close(); }

    // A runner parked on a shared approval bridge.
    const bridge = new SqliteApprovalBridge(join(dir, 'approvals.db'), { pollMs: 20 });
    const gated = (goal: Goal) => new AgentRunner({
      spec: createAgentSpec({ name: 'svc', goal }),
      reasoner: new DirectReasoner((ctx) =>
        ctx.observations.length ? { kind: 'complete', result: 'approved work' }
          : { kind: 'act', action: { capability: 'env.write', target: 'env://local/k', input: 1 } }),
      executor: { execute: (a) => Promise.resolve(createObservation({ actionId: a.id, source: a.target, kind: 'env-change', success: true })) },
      policy: { evaluate: () => 'require_approval' },
      human: bridge,
    });
    const { url, close } = await startAgentServer(gated, { port: 0, approvals: bridge });
    try {
      const created = await fetch(`${url}/goals`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'needs approval' }),
      });
      const { runId } = await created.json() as { runId: string };

      // The pending request is visible over HTTP.
      let pending: { id: string }[] = [];
      for (let i = 0; i < 100 && pending.length === 0; i++) {
        pending = await (await fetch(`${url}/approvals`)).json() as { id: string }[];
        if (pending.length === 0) await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(pending.length, 1, 'the parked run should be pending approval');

      const answered = await fetch(`${url}/approvals/${pending[0]!.id}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });
      assert.equal(answered.status, 200);
      assert.equal((await fetch(`${url}/approvals`)).status, 200);

      for (let i = 0; i < 100; i++) {
        const run = await (await fetch(`${url}/runs/${runId}`)).json() as { status: string };
        if (run.status === 'completed') return;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.fail('approved run should complete');
    } finally {
      await close();
      bridge.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('principals: roles gate endpoints — viewer reads, cannot write', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0,
    principals: {
      'tok-viewer': { id: 'bob', roles: ['viewer'] },
      'tok-ops': { id: 'carol', roles: ['operator'] },
      'tok-appr': { id: 'alice', roles: ['approver'] },
    },
  });
  try {
    const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
    assert.equal((await fetch(`${url}/runs`, { headers: bearer('tok-viewer') })).status, 200);
    assert.equal((await fetch(`${url}/runs`, { headers: bearer('nope') })).status, 401);
    assert.equal((await fetch(`${url}/runs`)).status, 401);

    const denied = await fetch(`${url}/goals`, {
      method: 'POST', headers: { ...bearer('tok-viewer'), 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'x' }),
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'forbidden', required: 'operator' });

    // operator implies viewer
    assert.equal((await fetch(`${url}/runs`, { headers: bearer('tok-ops') })).status, 200);
    const ok = await fetch(`${url}/goals`, {
      method: 'POST', headers: { ...bearer('tok-ops'), 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'x' }),
    });
    assert.equal(ok.status, 202);

    // approver implies viewer, not operator — and vice versa.
    assert.equal((await fetch(`${url}/runs`, { headers: bearer('tok-appr') })).status, 200);
    const apprDenied = await fetch(`${url}/goals`, {
      method: 'POST', headers: { ...bearer('tok-appr'), 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'x' }),
    });
    assert.equal(apprDenied.status, 403);
    assert.deepEqual(await apprDenied.json(), { error: 'forbidden', required: 'operator' });
  } finally {
    await close();
  }
});

test('principals: approver identity is attributed into the journal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-serve-'));
  try {
    const bridge = new SqliteApprovalBridge(join(dir, 'approvals.db'), { pollMs: 20 });
    const gated = (goal: Goal) => new AgentRunner({
      spec: createAgentSpec({ name: 'svc', goal }),
      reasoner: new DirectReasoner((ctx) =>
        ctx.observations.length ? { kind: 'complete', result: 'approved work' }
          : { kind: 'act', action: { capability: 'env.write', target: 'env://local/k', input: 1 } }),
      executor: { execute: (a) => Promise.resolve(createObservation({ actionId: a.id, source: a.target, kind: 'env-change', success: true })) },
      policy: { evaluate: () => 'require_approval' },
      human: bridge,
    });
    const { url, close } = await startAgentServer(gated, {
      port: 0,
      principals: {
        'tok-approver': { id: 'alice', roles: ['approver'] },
        'tok-ops': { id: 'carol', roles: ['operator'] },
      },
      approvals: bridge,
    });
    try {
      const bearer = { authorization: 'Bearer tok-approver' };
      const created = await fetch(`${url}/goals`, {
        method: 'POST', headers: { authorization: 'Bearer tok-ops', 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'needs sign-off' }),
      });
      assert.equal(created.status, 202);
      const { runId } = await created.json() as { runId: string };

      let pending: { id: string }[] = [];
      for (let i = 0; i < 100 && pending.length === 0; i++) {
        pending = await (await fetch(`${url}/approvals`, { headers: bearer })).json() as { id: string }[];
        if (pending.length === 0) await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(pending.length, 1);

      const answered = await fetch(`${url}/approvals/${pending[0]!.id}`, {
        method: 'POST', headers: { ...bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });
      assert.equal(answered.status, 200);

      // Approver identity lands on the run's journal event.
      for (let i = 0; i < 100; i++) {
        const run = await (await fetch(`${url}/runs/${runId}`, { headers: bearer })).json() as { status: string };
        if (run.status === 'completed') break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const sse = await (await fetch(`${url}/runs/${runId}/events`, { headers: bearer })).text();
      const events = sse.split('\n').filter((l) => l.startsWith('data: '))
        .map((l) => JSON.parse(l.slice(6)) as NaroEvent);
      const received = events.find((e) => e.type === 'human.approval.received');
      assert.equal((received?.data as { by?: string }).by, 'alice');
    } finally {
      await close();
      bridge.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('drain cancels in-flight runs — their journals end cancelled', async () => {
  let cancelled = false;
  const slowFactory = (goal: Goal) => {
    const runner = new AgentRunner({
      spec: createAgentSpec({ name: 'svc', goal }),
      // Loops acting with a slow executor — stays 'running' long enough for
      // the drain's abort to land; the loop-top check fires between iterations.
      reasoner: new DirectReasoner(() => ({ kind: 'act', action: { capability: 'env.set', target: 'env://local/k', input: 1 } })),
      executor: { execute: async (a) => { await new Promise((r) => setTimeout(r, 20)); return createObservation({ actionId: a.id, source: a.target, kind: 'env-change', success: true }); } },
      policy: allowAllPolicy,
    });
    runner.on('agent.cancelled', () => { cancelled = true; });
    return runner;
  };
  const { url, close } = await startAgentServer(slowFactory, { port: 0 });
  await fetch(`${url}/goals`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'slow' }),
  });
  await new Promise((r) => setTimeout(r, 30)); // let the run start
  await close(); // drains — aborts the run mid-flight
  for (let i = 0; i < 100 && !cancelled; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(cancelled, 'in-flight run should journal agent.cancelled during drain');
});
