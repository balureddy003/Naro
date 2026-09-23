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

test('GET /console serves the static page without auth, even when principals are configured', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0, principals: { tok: { id: 'x', roles: ['viewer'] } },
  });
  try {
    const res = await fetch(`${url}/console`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const body = await res.text();
    assert.match(body, /Naro — Ops Console/);
    // Consumes @naro/client rather than hand-rolling fetch/auth itself —
    // that SDK is what actually sends the Authorization header now.
    assert.match(body, /from '\/client\/index\.js'/);
  } finally {
    await close();
  }
});

test('console: false disables the route (404, not auth-gated)', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0, console: false });
  try {
    assert.equal((await fetch(`${url}/console`)).status, 404);
  } finally {
    await close();
  }
});

test('GET /client/index.js serves @naro/client\'s compiled module without auth', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0, principals: { tok: { id: 'x', roles: ['viewer'] } },
  });
  try {
    const res = await fetch(`${url}/client/index.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /javascript/);
    const body = await res.text();
    assert.match(body, /from '\.\/client\.js'/);
  } finally {
    await close();
  }
});

test('GET /client/ rejects anything outside [a-z0-9_-]+.js(.map)? — no path traversal', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0 });
  try {
    // %2F survives URL normalization as a literal path-segment character
    // (unlike a bare '../', which fetch() would normalize away before the
    // request is even sent) — this is what actually exercises the regex.
    assert.equal((await fetch(`${url}/client/${encodeURIComponent('../package.json')}`)).status, 404);
    assert.equal((await fetch(`${url}/client/types.js`)).status, 200); // a real file still works
  } finally {
    await close();
  }
});

test('client: false-equivalent — console: false also disables /client/*', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0, console: false });
  try {
    assert.equal((await fetch(`${url}/client/index.js`)).status, 404);
  } finally {
    await close();
  }
});

test('GET /runs/:id/events?since=N skips events at or below that seq', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0 });
  try {
    const res = await fetch(`${url}/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'cursor me' }),
    });
    const { runId } = await res.json() as { runId: string };
    await new Promise((r) => setTimeout(r, 50));

    const full = (await (await fetch(`${url}/runs/${runId}/events`)).text())
      .split('\n').filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)) as { seq: number });
    assert.ok(full.length >= 2);

    const cursor = full[0]!.seq;
    const resumed = (await (await fetch(`${url}/runs/${runId}/events?since=${cursor}`)).text())
      .split('\n').filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)) as { seq: number });
    assert.deepEqual(resumed.map((e) => e.seq), full.slice(1).map((e) => e.seq));
  } finally {
    await close();
  }
});

test('GET /runs/:id/events?since=<garbage> is a 400, not a silent full replay', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0 });
  try {
    const res = await fetch(`${url}/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'x' }),
    });
    const { runId } = await res.json() as { runId: string };
    assert.equal((await fetch(`${url}/runs/${runId}/events?since=nope`)).status, 400);
    assert.equal((await fetch(`${url}/runs/${runId}/events?since=-1`)).status, 400);
  } finally {
    await close();
  }
});

test('GET /runs/:id/evidence returns buildEvidence() over the run\'s journal', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0 });
  try {
    const res = await fetch(`${url}/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'evidence me' }),
    });
    const { runId } = await res.json() as { runId: string };
    await new Promise((r) => setTimeout(r, 50));
    const evidence = await (await fetch(`${url}/runs/${runId}/evidence`)).json() as {
      chain: { ok: boolean }; outcome?: { status: string }; counts: { actions: number };
    };
    assert.equal(evidence.chain.ok, true);
    assert.equal(evidence.outcome?.status, 'completed');
  } finally {
    await close();
  }
});

test('GET /runs/:id/evidence 404s for an unknown run', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0 });
  try {
    assert.equal((await fetch(`${url}/runs/nope/evidence`)).status, 404);
  } finally {
    await close();
  }
});

test('a run\'s traceId defaults to its own runId and GET /runs?traceId filters by it', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0 });
  try {
    const a = await (await fetch(`${url}/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'root a' }),
    })).json() as { runId: string };
    const b = await (await fetch(`${url}/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'root b' }),
    })).json() as { runId: string };
    await new Promise((r) => setTimeout(r, 50));

    const runA = await (await fetch(`${url}/runs/${a.runId}`)).json() as { traceId?: string };
    // no explicit traceId was passed in, so it defaults to the run's own id.
    assert.equal(runA.traceId, a.runId);

    const filtered = await (await fetch(`${url}/runs?traceId=${a.runId}`)).json() as { runId: string }[];
    assert.deepEqual(filtered.map((r) => r.runId), [a.runId]);
    assert.ok(!filtered.some((r) => r.runId === b.runId));
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

test('ADR 0013: a tenant-scoped principal only sees its own tenant\'s runs', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0,
    principals: {
      'tok-acme': { id: 'alice', roles: ['operator'], tenantId: 'acme' },
      'tok-globex': { id: 'bob', roles: ['operator'], tenantId: 'globex' },
      'tok-admin': { id: 'root', roles: ['operator'] }, // no tenant — sees everything
    },
  });
  try {
    const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
    const submit = async (token: string, description: string) => {
      const res = await fetch(`${url}/goals`, {
        method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      return (await res.json() as { runId: string }).runId;
    };

    const acmeRun = await submit('tok-acme', 'acme goal');
    const globexRun = await submit('tok-globex', 'globex goal');
    await new Promise((r) => setTimeout(r, 50)); // let goal.started land in the registry

    const listAs = async (token: string) =>
      (await (await fetch(`${url}/runs`, { headers: bearer(token) })).json() as { runId: string }[])
        .map((r) => r.runId);

    assert.deepEqual(await listAs('tok-acme'), [acmeRun]);
    assert.deepEqual(await listAs('tok-globex'), [globexRun]);
    const seenByAdmin = await listAs('tok-admin');
    assert.ok(seenByAdmin.includes(acmeRun) && seenByAdmin.includes(globexRun));

    // Cross-tenant direct reads are 404, not 403 — no confirmation the run exists.
    assert.equal((await fetch(`${url}/runs/${globexRun}`, { headers: bearer('tok-acme') })).status, 404);
    assert.equal((await fetch(`${url}/runs/${acmeRun}`, { headers: bearer('tok-acme') })).status, 200);
    assert.equal((await fetch(`${url}/runs/${globexRun}/events`, { headers: bearer('tok-acme') })).status, 404);
  } finally {
    await close();
  }
});

test('ADR 0013: a principal with no tenantId is unaffected (full visibility, as before)', async () => {
  const { url, close } = await startAgentServer(factory, { token: 'tok', port: 0 });
  try {
    const created = await fetch(`${url}/goals`, {
      method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'untenanted goal' }),
    });
    const { runId } = await created.json() as { runId: string };
    await new Promise((r) => setTimeout(r, 50));
    const list = await (await fetch(`${url}/runs`, { headers: { authorization: 'Bearer tok' } })).json() as { runId: string }[];
    assert.ok(list.some((r) => r.runId === runId));
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
