import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpoint, FileCheckpointStore, InMemoryCheckpointStore } from './checkpoint.ts';
import { SqliteCheckpointStore } from './sqlite-checkpoint.ts';

const data = { iteration: 3, tasks: [], actions: [], observations: [], context: [] };

test('in-memory store keeps history and returns latest', async () => {
  const s = new InMemoryCheckpointStore();
  await s.save(createCheckpoint('a1', 'REASONING', data));
  await s.save(createCheckpoint('a1', 'REASONING', { ...data, iteration: 4 }));
  const latest = await s.latest('a1');
  assert.equal(latest?.data.iteration, 4);
});

test('missing checkpoint returns undefined', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-ckpt-'));
  try {
    assert.equal(await new FileCheckpointStore(dir).latest('missing'), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('corrupt checkpoint fails loudly instead of starting a fresh run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-ckpt-'));
  try {
    await writeFile(join(dir, 'broken.checkpoints.jsonl'), '{not-json}\n');
    await assert.rejects(new FileCheckpointStore(dir).latest('broken'), SyntaxError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file store survives across instances (crash recovery)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-ckpt-'));
  try {
    const a = new FileCheckpointStore(dir);
    await a.save(createCheckpoint('agent-x', 'REASONING', data));
    // simulate process restart: brand-new store instance, same dir
    const b = new FileCheckpointStore(dir);
    const latest = await b.latest('agent-x');
    assert.equal(latest?.state, 'REASONING');
    assert.equal(latest?.data.iteration, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sqlite store prune keeps the newest N checkpoints per agent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-ckpt-'));
  const store = new SqliteCheckpointStore(join(dir, 'cp.db'));
  try {
    for (let i = 1; i <= 3; i++) {
      await store.save({ ...createCheckpoint('a1', 'REASONING', { ...data, iteration: i }), at: i });
      await store.save({ ...createCheckpoint('a2', 'REASONING', { ...data, iteration: i }), at: i });
    }
    assert.equal(store.prune(1), 4); // 3 per agent → 1 per agent
    assert.equal((await store.latest('a1'))?.data.iteration, 3);
    assert.equal((await store.latest('a2'))?.data.iteration, 3);
    assert.equal(store.prune(1), 0); // already minimal
    assert.equal(store.prune(0), 2); // keep nothing
    assert.equal(await store.latest('a1'), undefined);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
