import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryRunRegistry, SqliteRunRegistry, type RunRegistry, type RunSummary } from './run-registry.ts';

const run = (over: Partial<RunSummary> & { runId: string }): RunSummary => ({
  agentId: 'a1', status: 'completed', goal: 'g', startedAt: Date.now(), updatedAt: Date.now(), ...over,
});

async function eachRegistry(f: (label: string, make: () => Promise<RunRegistry>) => Promise<void>): Promise<void> {
  await f('InMemoryRunRegistry', () => Promise.resolve(new InMemoryRunRegistry()));
  await f('SqliteRunRegistry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'naro-runs-'));
    return new SqliteRunRegistry(join(dir, 'runs.db'));
  });
}

test('list() with no tenantId returns every run, tenant-stamped or not', async () => {
  await eachRegistry(async (label, make) => {
    const reg = await make();
    await reg.upsert(run({ runId: 'r1', tenantId: 'acme' }));
    await reg.upsert(run({ runId: 'r2' }));
    const all = await reg.list();
    assert.equal(all.length, 2, label);
  });
});

test('list({tenantId}) scopes to that tenant only', async () => {
  await eachRegistry(async (label, make) => {
    const reg = await make();
    await reg.upsert(run({ runId: 'r1', tenantId: 'acme' }));
    await reg.upsert(run({ runId: 'r2', tenantId: 'globex' }));
    await reg.upsert(run({ runId: 'r3' })); // no tenant — invisible to a scoped query
    const acme = await reg.list({ tenantId: 'acme' });
    assert.deepEqual(acme.map((r) => r.runId), ['r1'], label);
  });
});

test('get() round-trips tenantId', async () => {
  await eachRegistry(async (label, make) => {
    const reg = await make();
    await reg.upsert(run({ runId: 'r1', tenantId: 'acme' }));
    assert.equal((await reg.get('r1'))?.tenantId, 'acme', label);
  });
});

test('list({traceId}) scopes to one delegation tree', async () => {
  await eachRegistry(async (label, make) => {
    const reg = await make();
    await reg.upsert(run({ runId: 'root', traceId: 'root' }));
    await reg.upsert(run({ runId: 'child1', traceId: 'root' }));
    await reg.upsert(run({ runId: 'unrelated', traceId: 'other' }));
    const tree = await reg.list({ traceId: 'root' });
    assert.deepEqual(tree.map((r) => r.runId).sort(), ['child1', 'root'], label);
  });
});

test('tenantId and traceId filters combine', async () => {
  await eachRegistry(async (label, make) => {
    const reg = await make();
    await reg.upsert(run({ runId: 'a', tenantId: 'acme', traceId: 't1' }));
    await reg.upsert(run({ runId: 'b', tenantId: 'globex', traceId: 't1' }));
    const scoped = await reg.list({ tenantId: 'acme', traceId: 't1' });
    assert.deepEqual(scoped.map((r) => r.runId), ['a'], label);
  });
});

test('SqliteRunRegistry: an old database without tenant_id migrates in place', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-runs-'));
  const path = join(dir, 'runs.db');
  // Simulate a pre-ADR-0013 database: the original schema, no tenant_id.
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE runs (
      run_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL,
      goal TEXT NOT NULL, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      result TEXT, error TEXT, host TEXT
    );
  `);
  legacy.prepare('INSERT INTO runs (run_id, agent_id, status, goal, started_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run('old-run', 'a1', 'completed', 'legacy goal', Date.now(), Date.now());
  legacy.close();

  const reg = new SqliteRunRegistry(path);
  const found = await reg.get('old-run');
  assert.equal(found?.runId, 'old-run');
  assert.equal(found?.tenantId, undefined);
  await reg.upsert(run({ runId: 'new-run', tenantId: 'acme' }));
  assert.deepEqual((await reg.list({ tenantId: 'acme' })).map((r) => r.runId), ['new-run']);
});
