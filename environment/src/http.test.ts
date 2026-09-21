import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal, createAction } from '@naro/core';
import { InMemoryEnvironment } from './in-memory.ts';
import { HttpEnvironment, serveEnvironment } from './http.ts';

const GOAL = createGoal({ description: 'test goal' });
const ctx = { agentId: 'a1', goalId: GOAL.id, goal: GOAL, grants: [] };
const act = (capability: string, target: string, input?: unknown) =>
  createAction('a1', { capability, target, input });

test('HttpEnvironment executes against a served environment — same contract', async () => {
  const local = new InMemoryEnvironment('remote-kv');
  const { url, close } = await serveEnvironment(local, { port: 0 });
  try {
    const remote = new HttpEnvironment(url, { id: 'remote-kv', capabilities: local.capabilities });
    await remote.execute(act('env.set', 'env://remote-kv/greeting', 'hello'), ctx);
    const obs = await remote.execute(act('env.get', 'env://remote-kv/greeting'), ctx);
    assert.equal(obs.success, true);
    assert.equal(obs.output, 'hello');
    // The write happened on the server side — the remote state is authoritative.
    assert.deepEqual((await remote.state()).resources, { greeting: 'hello' });
    assert.deepEqual(local.changes(), ['set greeting']);
  } finally {
    await close();
  }
});

test('server-side errors come back as failed observations, not crashes', async () => {
  const local = new InMemoryEnvironment();
  const { url, close } = await serveEnvironment(local, { port: 0 });
  try {
    const remote = new HttpEnvironment(url);
    const obs = await remote.execute(act('env.get', 'env://local/missing'), ctx);
    assert.equal(obs.success, false);
    assert.match(obs.error ?? '', /not found/);
    assert.equal(obs.actionId, obs.actionId); // correlated back to the action
  } finally {
    await close();
  }
});

test('a dead remote produces a failed observation — the run survives', async () => {
  const local = new InMemoryEnvironment();
  const { url, close } = await serveEnvironment(local, { port: 0 });
  await close(); // hands are gone
  const remote = new HttpEnvironment(url, { timeoutMs: 500 });
  await assert.rejects(() => remote.execute(act('env.get', 'env://local/x'), ctx));
});

test('optional bearer token gates the endpoint', async () => {
  const local = new InMemoryEnvironment();
  const { url, close } = await serveEnvironment(local, { port: 0, token: 's3cret' });
  try {
    const noAuth = new HttpEnvironment(url, { timeoutMs: 500 });
    const obs = await noAuth.execute(act('env.get', 'env://local/x'), ctx);
    assert.equal(obs.success, false);
    assert.match(obs.error ?? '', /401/);

    const authed = new HttpEnvironment(url, { token: 's3cret' });
    const ok = await authed.execute(act('env.set', 'env://local/k', 1), ctx);
    assert.equal(ok.success, true);
  } finally {
    await close();
  }
});
