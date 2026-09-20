import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMemoryStore } from './sqlite-store.ts';

const store = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-mem-'));
  return new SqliteMemoryStore(join(dir, 'mem.db'));
};

test('write → read round-trips content faithfully, strings included', async () => {
  const s = await store();
  await s.write({ tier: 'semantic', key: 'n', content: '42' });
  const e = await s.read('n');
  assert.equal(e?.content, '42'); // string, not number
  await s.write({ tier: 'semantic', key: 'o', content: { nested: [1, 2] } });
  assert.deepEqual((await s.read('o'))?.content, { nested: [1, 2] });
});

test('FTS5 recall ranks relevant entries', async () => {
  const s = await store();
  await s.write({ tier: 'episodic', key: 'a', content: 'deployed the web service to prod' });
  await s.write({ tier: 'episodic', key: 'b', content: 'ordered lunch for the team' });
  const hits = await s.search('deployed prod');
  assert.equal(hits[0]?.key, 'a');
});

test('forget is durable across a fresh store instance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-mem-'));
  const path = join(dir, 'mem.db');
  const s1 = new SqliteMemoryStore(path);
  await s1.write({ tier: 'session', key: 'k', content: 'gone soon' });
  assert.equal(await s1.forget('k'), true);
  s1.close();
  const s2 = new SqliteMemoryStore(path);
  assert.equal(await s2.read('k'), undefined);
  assert.equal((await s2.search('gone')).length, 0); // FTS index cleaned too
});

test('searchTier confines recall to one tier', async () => {
  const s = await store();
  await s.write({ tier: 'working', key: 'w', content: 'shared keyword' });
  await s.write({ tier: 'semantic', key: 's', content: 'shared keyword' });
  const hits = await s.searchTier('semantic', 'keyword');
  assert.deepEqual(hits.map((h) => h.key), ['s']);
});

import { memoryStoreContract } from '@naro/contract-tests';
memoryStoreContract('SqliteMemoryStore', store);
