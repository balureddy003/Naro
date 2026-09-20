import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryMemoryStore } from './in-memory.ts';
import { FileMemoryStore } from './file-store.ts';

test('write → read → search round-trip', async () => {
  const mem = new InMemoryMemoryStore();
  await mem.write({ key: 'deploy-fail', content: 'deploy to prod failed at migration step', tier: 'episodic', tags: ['deploy'] });
  await mem.write({ key: 'coffee', content: 'unrelated fact', tier: 'semantic' });

  assert.equal((await mem.read('deploy-fail'))?.tier, 'episodic');
  const hits = await mem.search('deploy failed');
  assert.equal(hits[0]?.key, 'deploy-fail');
});

test('tier-scoped search only recalls that tier', async () => {
  const mem = new InMemoryMemoryStore();
  await mem.write({ key: 'a', content: 'deploy note', tier: 'episodic' });
  await mem.write({ key: 'b', content: 'deploy note', tier: 'semantic' });
  const hits = await mem.searchTier('semantic', 'deploy');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.key, 'b');
});

test('file store persists across instances', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-mem-'));
  try {
    await new FileMemoryStore(dir).write({ key: 'k', content: 'remember me', tier: 'longterm' });
    const fresh = new FileMemoryStore(dir); // new instance = "restart"
    assert.equal((await fresh.read('k'))?.content, 'remember me');
    assert.equal((await fresh.search('remember'))[0]?.key, 'k');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('search returns ranked hits only (no zero-score noise)', async () => {
  const mem = new InMemoryMemoryStore();
  await mem.write({ key: 'x', content: 'nothing relevant' });
  assert.equal((await mem.search('completely different words')).length, 0);
});
