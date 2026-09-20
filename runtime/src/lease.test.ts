import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowAllPolicy, createAgentSpec, createGoal, createObservation } from '@naro/core';
import { AgentRunner } from './runner.ts';
import { DirectReasoner } from './reasoner-direct.ts';
import { InMemoryLeaseStore, SqliteLeaseStore } from './lease.ts';

const goal = createGoal({ description: 'leased run' });
const echo = { execute: (a: { id: string; target: string }) => Promise.resolve(createObservation({
  actionId: a.id, source: a.target, kind: 'env-change', success: true, output: 'ok',
})) };

const spec = createAgentSpec({ name: 'leased', goal });
const runner = (store: InMemoryLeaseStore | SqliteLeaseStore) => new AgentRunner({
  spec,
  reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'done' })),
  executor: echo,
  policy: allowAllPolicy,
  lease: { store, ttlMs: 5000 },
});

for (const [name, make] of [
  ['InMemoryLeaseStore', () => new InMemoryLeaseStore()],
  ['SqliteLeaseStore', async () => new SqliteLeaseStore(join(await mkdtemp(join(tmpdir(), 'naro-lease-')), 'l.db'))],
] as const) {
  test(`${name}: a second concurrent runner is refused`, async () => {
    const store = await make();
    // Take the lease out from under the runner before it starts.
    await store.acquire(`agent:${spec.id}`, 'other-process', 5000);
    const res = await runner(store).run();
    assert.equal(res.status, 'failed');
    assert.match(res.error!, /lease held|already running/);
  });

  test(`${name}: free lease → run completes and releases`, async () => {
    const store = await make();
    const res = await runner(store).run();
    assert.equal(res.status, 'completed');
    // Lease was released — a follow-up run on the same store succeeds.
    const res2 = await runner(store).run();
    assert.equal(res2.status, 'completed');
  });
}

test('expired lease is re-acquirable — crashed holder does not deadlock', async () => {
  const store = new InMemoryLeaseStore();
  assert.equal(await store.acquire('k', 'dead-runner', 30), true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(await store.acquire('k', 'new-runner', 5000), true);
});

test('heartbeat keeps a live lease; lost holder cannot heartbeat', async () => {
  const store = new InMemoryLeaseStore();
  await store.acquire('k', 'h1', 60);
  assert.equal(await store.heartbeat('k', 'h1', 60), true);
  assert.equal(await store.heartbeat('k', 'impostor', 60), false);
});
