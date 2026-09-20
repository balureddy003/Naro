import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal } from '@naro/core';
import { A2aAgentBus, cardToDescriptor, type AgentCard } from './a2a.ts';

const card = (name: string): Omit<AgentCard, 'url'> => ({
  name, description: `${name} agent`, version: '0.1.0',
  capabilities: { streaming: false, pushNotifications: false },
  skills: [{ id: 'math', name: 'Math', description: 'arithmetic' }],
});

test('tasks/send crosses real HTTP with agent card discovery', async () => {
  const endpoints = new Map<string, string>();
  // worker process side: card + handler + JSON-RPC endpoint
  const worker = new A2aAgentBus({ resolve: (id) => endpoints.get(id) });
  worker.advertise(card('worker'));
  worker.serve('worker', async (msg) => `solved:${msg.goal.description}`);
  const listener = await worker.listen(0);
  endpoints.set('worker', listener.url);
  try {
    // parent side: discovers the card, then sends a task
    const parent = new A2aAgentBus({ resolve: (id) => endpoints.get(id) });
    const res = await parent.request('worker', createGoal({ description: '2+2' }), 'parent');
    assert.equal(res, 'solved:2+2');
  } finally { await listener.close(); }
});

test('agent card is served at the well-known URL', async () => {
  const endpoints = new Map<string, string>();
  const worker = new A2aAgentBus({ resolve: () => undefined });
  worker.advertise(card('worker'));
  worker.serve('worker', async () => 'ok');
  const listener = await worker.listen(0);
  try {
    const res = await fetch(`${listener.url}/.well-known/agent.json`);
    const c = await res.json() as AgentCard;
    assert.equal(c.name, 'worker');
    assert.equal(c.skills[0]!.id, 'math');
    assert.equal(cardToDescriptor(c).capabilities[0], 'math');
  } finally { await listener.close(); }
});

test('worker failure returns a failed task state, not a silent error', async () => {
  const endpoints = new Map<string, string>();
  const worker = new A2aAgentBus({ resolve: (id) => endpoints.get(id) });
  worker.advertise(card('w'));
  worker.serve('w', async () => { throw new Error('broke'); });
  const listener = await worker.listen(0);
  endpoints.set('w', listener.url);
  try {
    const parent = new A2aAgentBus({ resolve: (id) => endpoints.get(id) });
    await assert.rejects(parent.request('w', createGoal({ description: 'x' }), 'p'), /failed/);
  } finally { await listener.close(); }
});

test('unknown agent resolves to a clear error', async () => {
  const bus = new A2aAgentBus({ resolve: () => undefined });
  await assert.rejects(bus.request('ghost', createGoal({ description: 'x' }), 'p'), /no A2A endpoint/);
});

test('message/stream delivers lifecycle events then the completed task', async () => {
  const endpoints = new Map<string, string>();
  const worker = new A2aAgentBus({ resolve: (id) => endpoints.get(id) });
  worker.advertise(card('worker'));
  worker.serve('worker', async (msg) => `solved:${msg.goal.description}`);
  const listener = await worker.listen(0);
  endpoints.set('worker', listener.url);
  try {
    const states: string[] = [];
    const parent = new A2aAgentBus({ resolve: (id) => endpoints.get(id) });
    const res = await parent.requestStream('worker', createGoal({ description: '2+2' }), 'parent', (task) => {
      states.push((task as { status?: { state?: string } }).status?.state ?? '?');
    });
    assert.deepEqual(states, ['submitted', 'working', 'completed']);
    assert.equal(res, 'solved:2+2');
  } finally { await listener.close(); }
});

test('tasks/cancel marks a stored task; unknown tasks error', async () => {
  const endpoints = new Map<string, string>();
  const worker = new A2aAgentBus({ resolve: (id) => endpoints.get(id) });
  worker.advertise(card('worker'));
  worker.serve('worker', async (msg) => `solved:${msg.goal.description}`);
  const listener = await worker.listen(0);
  try {
    const rpc = (method: string, params: unknown) => fetch(`${listener.url}/`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'x', method, params }),
    }).then((r) => r.json()) as Promise<{ result?: { id: string; status: { state: string } }; error?: { message: string } }>;

    const sent = await rpc('message/send', {
      id: 'task-1', message: { role: 'user', parts: [{ kind: 'text', text: 'hi' }] },
    });
    assert.equal(sent.result?.status.state, 'completed');

    const canceled = await rpc('tasks/cancel', { id: 'task-1' });
    assert.equal(canceled.result?.status.state, 'canceled');

    const got = await rpc('tasks/get', { id: 'task-1' });
    assert.equal(got.result?.status.state, 'canceled');

    const miss = await rpc('tasks/cancel', { id: 'nope' });
    assert.match(miss.error!.message, /unknown task/);
  } finally { await listener.close(); }
});
