import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from './event-bus.ts';
import { createGoal } from '@naro/core';

test('emits typed events to per-type and wildcard listeners in order', () => {
  const bus = new EventBus({ agentId: 'a1', goalId: 'g1' });
  const seen: string[] = [];
  bus.on('agent.created', (e) => seen.push(`created:${e.data.name}`));
  bus.on('*', (e) => seen.push(`*:${e.type}:${e.seq}`));

  bus.emit('agent.created', { name: 'tester' });
  bus.emit('reasoning.started', { iteration: 0 });

  assert.deepEqual(seen, ['created:tester', '*:agent.created:1', '*:reasoning.started:2']);
});

test('history preserves the full ordered log', () => {
  const bus = new EventBus({ agentId: 'a1', goalId: 'g1' });
  bus.emit('agent.created', { name: 'x' });
  bus.emit('agent.completed', { result: 42 });
  const h = bus.history();
  assert.equal(h.length, 2);
  assert.equal(h[1]!.seq, 2);
  assert.equal(h[0]!.agentId, 'a1');
});

test('unsubscribe stops delivery', () => {
  const bus = new EventBus({ agentId: 'a1', goalId: 'g1' });
  let count = 0;
  const off = bus.on('reasoning.started', () => count++);
  bus.emit('reasoning.started', { iteration: 0 });
  off();
  bus.emit('reasoning.started', { iteration: 1 });
  assert.equal(count, 1);
});

test('goal ids ride on every event for traceability', () => {
  const goal = createGoal({ description: 'trace me' });
  const bus = new EventBus({ agentId: 'a1', goalId: goal.id });
  const e = bus.emit('agent.created', { name: 'x' });
  assert.equal(e.goalId, goal.id);
});
