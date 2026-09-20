import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, createObservation, type ActionExecutor, type ExecContext, type Goal } from '@naro/core';
import { ShardedExecutor, routedBy } from './sharded-executor.ts';

const goal: Goal = { id: 'g', description: 't', constraints: [], successCriteria: [], priority: 1, metadata: {} };
const ctx: ExecContext = { agentId: 'a', goalId: 'g', goal, grants: [] };

const recorder = (name: string, hits: string[]): ActionExecutor => ({
  execute: (a) => {
    hits.push(`${name}:${a.target}`);
    return Promise.resolve(createObservation({ actionId: a.id, source: name, kind: 'env-change', success: true, output: name }));
  },
});

test('same key always lands on the same shard', async () => {
  const a: string[] = []; const b: string[] = [];
  const ex = new ShardedExecutor({ shards: [recorder('s0', a), recorder('s1', b)] });
  for (let i = 0; i < 20; i++) {
    await ex.execute(createAction('a', { capability: 'env.get', target: 'env://tenant-1/k' + (i % 3), input: {} }), ctx);
  }
  const hits = [...a, ...b];
  assert.equal(hits.length, 20);
  // each distinct target went to exactly one shard
  const byKey = new Map<string, string>();
  for (const h of hits) {
    const i = h.indexOf(':');
    const shard = h.slice(0, i), target = h.slice(i + 1);
    assert.ok(!byKey.has(target) || byKey.get(target) === shard, `${target} moved shards`);
    byKey.set(target, shard);
  }
});

test('routedBy: explicit routing, miss is a failed observation', async () => {
  const hits: string[] = [];
  const ex = routedBy((a) => a.target.startsWith('env://a/') ? recorder('A', hits) : undefined);
  const ok = await ex.execute(createAction('a', { capability: 'x', target: 'env://a/k', input: {} }), ctx);
  assert.equal(ok.success, true);
  const miss = await ex.execute(createAction('a', { capability: 'x', target: 'env://zzz/k', input: {} }), ctx);
  assert.equal(miss.success, false);
  assert.match(miss.error!, /no shard/);
});
