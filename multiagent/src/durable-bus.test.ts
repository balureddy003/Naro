import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGoal } from '@naro/core';
import { DurableAgentBus } from './durable-bus.ts';

const mkBus = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-bus-'));
  return new DurableAgentBus(join(dir, 'bus.db'), { pollMs: 5 });
};

test('request → serve → result flows through durable rows', async () => {
  const bus = await mkBus();
  bus.serve('solver', async (msg) => `solved:${msg.goal.description}`);
  const r = await bus.request('solver', createGoal({ description: '2+2' }), 'lead', 5_000);
  assert.equal(r, 'solved:2+2');
  const rows = bus.tasks('completed');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.from_agent, 'lead');
  bus.close();
});

test('pending tasks survive a requester-less window — durable queue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-bus-'));
  const path = join(dir, 'bus.db');
  const producer = new DurableAgentBus(path, { pollMs: 5 });
  // enqueue without awaiting — the row exists before any worker is up
  const p = producer.request('worker', createGoal({ description: 'later' }), 'lead', 5_000);
  // worker comes online later, sees the persisted task
  const worker = new DurableAgentBus(path, { pollMs: 5 });
  worker.serve('worker', async () => 'done');
  assert.equal(await p, 'done');
  producer.close(); worker.close();
});

test('timeout marks the task timed-out and the request rejects', async () => {
  const bus = await mkBus();
  await assert.rejects(
    bus.request('nobody', createGoal({ description: 'x' }), 'lead', 60),
    /timed out/,
  );
  assert.equal(bus.tasks('timed-out').length, 1);
  bus.close();
});

test('handler failure is recorded durably', async () => {
  const bus = await mkBus();
  bus.serve('w', async () => { throw new Error('boom'); });
  await assert.rejects(
    bus.request('w', createGoal({ description: 'x' }), 'lead', 5_000), /boom/);
  assert.equal(bus.tasks('failed').length, 1);
  bus.close();
});
