import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal } from '@naro/core';
import { HttpAgentBus } from './http-bus.ts';

test('task requests cross a real TCP boundary', async () => {
  // Worker process side: a bus serving 'worker' over HTTP.
  const endpoints = new Map<string, string>();
  const workerBus = new HttpAgentBus({ resolve: (id) => endpoints.get(id) });
  workerBus.serve('worker', async (msg) => `pong:${msg.goal.description}:from:${msg.from}`);
  const listener = await workerBus.listen(0);
  endpoints.set('worker', listener.url);
  try {
    // Parent side: a separate bus instance, resolving by URL.
    const parentBus = new HttpAgentBus({ resolve: (id) => endpoints.get(id) });
    const result = await parentBus.request('worker', createGoal({ description: 'ping' }), 'parent');
    assert.equal(result, 'pong:ping:from:parent');
  } finally {
    await listener.close();
  }
});

test('unknown endpoint and worker errors surface distinctly', async () => {
  const bus = new HttpAgentBus({ resolve: () => undefined });
  await assert.rejects(bus.request('ghost', createGoal({ description: 'x' }), 'p'), /no endpoint/);

  const endpoints = new Map<string, string>();
  const worker = new HttpAgentBus({ resolve: (id) => endpoints.get(id) });
  worker.serve('bad', async () => { throw new Error('worker exploded'); });
  const listener = await worker.listen(0);
  endpoints.set('bad', listener.url);
  const bus2 = new HttpAgentBus({ resolve: (id) => endpoints.get(id) });
  try {
    await assert.rejects(bus2.request('bad', createGoal({ description: 'x' }), 'p'), /worker exploded/);
  } finally {
    await listener.close();
  }
});

test('bearer token auth: missing/wrong tokens get 401', async () => {
  const endpoints = new Map<string, string>();
  const token = 'shared-secret';
  const worker = new HttpAgentBus({ resolve: (id) => endpoints.get(id), token });
  worker.serve('w', async () => 'ok');
  const listener = await worker.listen(0);
  endpoints.set('w', listener.url);
  try {
    const authed = new HttpAgentBus({ resolve: (id) => endpoints.get(id), token });
    assert.equal(await authed.request('w', createGoal({ description: 'x' }), 'p'), 'ok');
    const anon = new HttpAgentBus({ resolve: (id) => endpoints.get(id) });
    await assert.rejects(anon.request('w', createGoal({ description: 'x' }), 'p'), /401/);
    const wrong = new HttpAgentBus({ resolve: (id) => endpoints.get(id), token: 'nope' });
    await assert.rejects(wrong.request('w', createGoal({ description: 'x' }), 'p'), /401/);
  } finally {
    await listener.close();
  }
});
