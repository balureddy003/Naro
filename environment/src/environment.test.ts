import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal, createAction } from '@naro/core';
const GOAL = createGoal({ description: 'test goal' });
import { InMemoryEnvironment } from './in-memory.ts';

const ctx = { agentId: 'a1', goalId: 'g1' , goal: GOAL, grants: []};
const act = (capability: string, target: string, input?: unknown) =>
  createAction('a1', { capability, target, input });

test('set then get round-trips a value', async () => {
  const env = new InMemoryEnvironment();
  await env.execute(act('env.set', 'env://local/greeting', 'hello'), ctx);
  const obs = await env.execute(act('env.get', 'env://local/greeting'), ctx);
  assert.equal(obs.success, true);
  assert.equal(obs.output, 'hello');
});

test('reads of missing keys fail honestly', async () => {
  const env = new InMemoryEnvironment();
  const obs = await env.execute(act('env.get', 'env://local/nope'), ctx);
  assert.equal(obs.success, false);
  assert.match(obs.error ?? '', /not found/);
});

test('state() snapshots the world; change log records mutations', async () => {
  const env = new InMemoryEnvironment('local', { seed: 1 });
  await env.execute(act('env.set', 'env://local/a', 2), ctx);
  await env.execute(act('env.delete', 'env://local/seed'), ctx);

  const state = env.state();
  assert.deepEqual(state.resources, { a: 2 });
  assert.deepEqual(env.changes(), ['set a', 'delete seed']);
});

test('unknown capabilities are refused, not faked', async () => {
  const env = new InMemoryEnvironment();
  const obs = await env.execute(act('env.fly', 'env://local/x'), ctx);
  assert.equal(obs.success, false);
  assert.match(obs.error ?? '', /does not support/);
});
