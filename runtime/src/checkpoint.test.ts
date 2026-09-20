import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpoint, FileCheckpointStore, InMemoryCheckpointStore } from './checkpoint.ts';

const data = { iteration: 3, tasks: [], observations: [], context: [] };

test('in-memory store keeps history and returns latest', async () => {
  const s = new InMemoryCheckpointStore();
  await s.save(createCheckpoint('a1', 'REASONING', data));
  await s.save(createCheckpoint('a1', 'REASONING', { ...data, iteration: 4 }));
  const latest = await s.latest('a1');
  assert.equal(latest?.data.iteration, 4);
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
