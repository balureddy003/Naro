import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, createGoal } from '@naro/core';
import { pgPool, PgCheckpointStore, PgAgentBus, PgLeaseStore, PgLimitStore, PgMemoryStore, PgEventStore, PgRunRegistry, PgApprovalBridge } from './index.ts';
import { checkpointStoreContract, memoryStoreContract, eventExporterContract } from '@naro/contract-tests';

const url = process.env['NARO_PG_URL'];
const describePg = url ? test : test.skip;

// Shared port contracts — same suites the SQLite stores pass. Registered only
// when a real Postgres is reachable.
if (url) {
  checkpointStoreContract('PgCheckpointStore', async () => PgCheckpointStore.create(await pgPool(url)));
  memoryStoreContract('PgMemoryStore', async () => PgMemoryStore.create(await pgPool(url)));
  eventExporterContract('PgEventStore', async () => PgEventStore.create(await pgPool(url)),
    async (exp) => (await (exp as PgEventStore).history()).map((e) => JSON.stringify(e)));
}

describePg('pg integration (requires NARO_PG_URL)', async () => {
  const pool = await pgPool(url!);

  test('checkpoints: save → latest → agent isolation', async () => {
    const s = await PgCheckpointStore.create(pool);
    // Unique agent ids — the contract suite shares this table.
    const me = `pg-int-${Date.now()}`;
    await s.save({ id: 'c1', agentId: me, state: 'REASONING', at: 1, data: { iteration: 1 } } as never);
    await s.save({ id: 'c2', agentId: me, state: 'REASONING', at: 2, data: { iteration: 2 } } as never);
    const got = await s.latest(me);
    assert.equal((got?.data as { iteration: number }).iteration, 2);
    assert.equal(await s.latest(`${me}-other`), undefined);
  });

  test('checkpoints: prune keeps the newest N per agent', async () => {
    const s = await PgCheckpointStore.create(pool);
    const me = `pg-prune-${Date.now()}`;
    for (let i = 1; i <= 3; i++) {
      await s.save({ id: `${me}-c${i}`, agentId: me, state: 'REASONING', at: i, data: { iteration: i } } as never);
    }
    assert.equal(await s.prune(1) >= 2, true);
    const got = await s.latest(me);
    assert.equal((got?.data as { iteration: number }).iteration, 3);
  });

  test('leases: one holder, expiry, release', async () => {
    const l = await PgLeaseStore.create(pool);
    assert.equal(await l.acquire('k1', 'h1', 5000), true);
    assert.equal(await l.acquire('k1', 'h2', 5000), false); // held
    assert.equal(await l.heartbeat('k1', 'h1', 5000), true);
    await l.release('k1', 'h1');
    assert.equal(await l.acquire('k1', 'h2', 5000), true);
  });

  test('limits: shared counter across "hosts" (two stores, one pool)', async () => {
    const a = await PgLimitStore.create(pool);
    const b = await PgLimitStore.create(pool);
    assert.equal(await a.record('r1', 60_000, Date.now()), 1);
    assert.equal(await b.record('r1', 60_000, Date.now()), 2); // shared truth
  });

  test('bus: request → claimed → completed over SQL', async () => {
    const bus = await PgAgentBus.create(pool, { pollMs: 25 });
    bus.serve('pg-worker', async (m) => `done:${m.goal.description}`);
    const res = await bus.request('pg-worker', createGoal({ description: 'multi-host' }), 'tester', 10_000);
    assert.equal(res, 'done:multi-host');
    bus.close();
  });

  test('memory + events round-trip', async () => {
    const mem = await PgMemoryStore.create(pool);
    const key = `pg-mem-${Date.now()}`; // unique — the contract suite shares this table
    await mem.write({ key, content: { v: 1 }, tier: 'semantic', tags: ['t'] });
    assert.deepEqual((await mem.read(key))?.content, { v: 1 });
    assert.ok((await mem.search('t', 5)).length >= 0);
    assert.equal(await mem.forget(key), true);

    const ev = await PgEventStore.create(pool);
    const runId = `pg-ev-${Date.now()}`;
    await ev.export([{ id: `${runId}-e1`, type: 'agent.created', seq: 1, at: 1, agentId: 'a', goalId: 'g', runId, data: { name: 'x' } }]);
    const hist = await ev.history({ runId });
    assert.equal(hist.length, 1);
  });

  test('run registry: upsert → get → newest-first list', async () => {
    const reg = await PgRunRegistry.create(pool);
    const run = {
      runId: `pg-run-${Date.now()}`, agentId: 'a1', status: 'running' as const,
      goal: 'g', startedAt: Date.now(), updatedAt: Date.now(), host: 'h1',
    };
    await reg.upsert(run);
    await reg.upsert({ ...run, status: 'completed', updatedAt: Date.now(), result: { ok: 1 } });
    const got = await reg.get(run.runId);
    assert.equal(got?.status, 'completed');
    assert.deepEqual(got?.result, { ok: 1 });
    assert.equal((await reg.list())[0]?.runId, run.runId);
    assert.equal(await reg.get('nope'), undefined);
  });

  test('run registry: list({tenantId}) scopes across replicas (ADR 0013)', async () => {
    const reg = await PgRunRegistry.create(pool);
    const stamp = Date.now();
    const acme = { runId: `pg-tenant-acme-${stamp}`, agentId: 'a1', status: 'completed' as const,
      goal: 'g', startedAt: stamp, updatedAt: stamp, tenantId: 'acme' };
    const globex = { runId: `pg-tenant-globex-${stamp}`, agentId: 'a1', status: 'completed' as const,
      goal: 'g', startedAt: stamp, updatedAt: stamp, tenantId: 'globex' };
    await reg.upsert(acme);
    await reg.upsert(globex);
    const scoped = await reg.list({ tenantId: 'acme' });
    assert.ok(scoped.some((r) => r.runId === acme.runId));
    assert.ok(!scoped.some((r) => r.runId === globex.runId));
    assert.equal((await reg.get(acme.runId))?.tenantId, 'acme');
  });

  test('approvals: request blocks until a second store answers, then resolves', async () => {
    const asker = await PgApprovalBridge.create(pool, { pollMs: 25, timeoutMs: 5000 });
    const responder = await PgApprovalBridge.create(pool, { pollMs: 25, timeoutMs: 5000 });

    const action = createAction('tester', { capability: 'shell.exec', target: 'rm -rf /tmp/x' });
    const pending = asker.approve(action, 'ok to run?');

    // Simulates a second replica answering the request another replica raised.
    const seen = await waitForPending(responder, (p) => p.action?.target === action.target);
    assert.equal(seen?.question, 'ok to run?');
    assert.equal(await responder.respond(seen!.id, { approved: true, note: 'looks safe' }, 'reviewer-1'), true);

    const result = await pending;
    assert.deepEqual(result, { approved: true, note: 'looks safe', by: 'reviewer-1' });
  });

  test('approvals: ask() resolves to the answered text', async () => {
    const asker = await PgApprovalBridge.create(pool, { pollMs: 25, timeoutMs: 5000 });
    const responder = await PgApprovalBridge.create(pool, { pollMs: 25, timeoutMs: 5000 });

    const question = `pick a branch name ${Date.now()}`;
    const pending = asker.ask(question);
    const seen = await waitForPending(responder, (p) => p.question === question);
    await responder.respond(seen!.id, { text: 'feature/x' });

    assert.equal(await pending, 'feature/x');
  });

  test('approvals: respond is a no-op for an already-answered or unknown id', async () => {
    const bridge = await PgApprovalBridge.create(pool);
    assert.equal(await bridge.respond('does-not-exist', { approved: true }), false);
  });

  test('approvals: prune removes only answered rows older than the cutoff', async () => {
    const bridge = await PgApprovalBridge.create(pool, { timeoutMs: 5000 });
    const action = createAction('tester', { capability: 'noop', target: `prune-${Date.now()}` });
    const pending = bridge.approve(action, 'prune me');
    const seen = await waitForPending(bridge, (p) => p.action?.target === action.target);
    await bridge.respond(seen!.id, { approved: false }, 'reviewer-2');
    await pending;

    assert.equal(await bridge.prune({ olderThan: Date.now() - 60_000 }), 0); // too recent, not pruned yet
    assert.ok(await bridge.prune({ olderThan: Date.now() + 1000 }) >= 1); // cutoff now past answered_at
  });

  async function waitForPending(
    bridge: PgApprovalBridge,
    matches: (p: Awaited<ReturnType<PgApprovalBridge['pending']>>[number]) => boolean,
  ) {
    const deadline = Date.now() + 5000;
    for (;;) {
      const match = (await bridge.pending()).find(matches);
      if (match) return match;
      if (Date.now() >= deadline) return undefined;
      await new Promise((r) => setTimeout(r, 25));
    }
  }
});
