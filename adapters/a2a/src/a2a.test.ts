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
