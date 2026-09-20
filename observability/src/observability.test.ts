import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowAllPolicy, createAgentSpec, createGoal, createObservation, type ActionExecutor } from '@naro/core';
import { AgentRunner, DirectReasoner } from '@naro/runtime';
import { JsonlExporter, pipeTo } from './exporter.ts';
import { computeMetrics } from './metrics.ts';

const echo: ActionExecutor = {
  execute: (a) => Promise.resolve(createObservation({ actionId: a.id, source: a.target, kind: 'env-change', success: true })),
};

async function realRun() {
  const reasoner = new DirectReasoner((ctx) =>
    ctx.observations.length === 0
      ? { kind: 'act', action: { capability: 'env.set', target: 'env://local/k', input: 1 } }
      : { kind: 'complete', result: 'done' });
  const runner = new AgentRunner({
    spec: createAgentSpec({ goal: createGoal({ description: 'm' }) }),
    reasoner, executor: echo,
  policy: allowAllPolicy,
  });
  const live: string[] = [];
  const dir = await mkdtemp(join(tmpdir(), 'naro-obs-'));
  const file = join(dir, 'audit.jsonl');
  runner.on('*', (e) => live.push(e.type));
  const pipe = pipeTo(runner as never, new JsonlExporter(file));
  const result = await runner.run();
  pipe.stop();
  await pipe.flush();
  return { result, live, file, dir };
}

test('metrics computed from a real run match the event stream', async () => {
  const { result } = await realRun();
  const m = computeMetrics(result.events);
  assert.equal(m.actionsRequested, 1);
  assert.equal(m.observations, 1);
  assert.equal(m.actionsDenied, 0);
  assert.ok(m.iterations >= 2);
  assert.equal(m.totalEvents, result.events.length);
});

test('JsonlExporter writes a replayable audit file', async () => {
  const { file, dir, result } = await realRun();
  try {
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    assert.equal(lines.length, result.events.length);
    const parsed = lines.map((l) => JSON.parse(l) as { type: string; seq: number });
    assert.equal(parsed[0]!.type, 'agent.created');
    assert.equal(parsed.at(-1)!.type, 'agent.completed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('computeMetrics aggregates model.usage totals', async () => {
  const { computeMetrics } = await import('./metrics.ts');
  const ev = (seq: number, type: string, data: object) => ({
    id: `e${seq}`, type, seq, at: seq, agentId: 'a', goalId: 'g', runId: 'r', data,
  });
  const m = computeMetrics([
    ev(1, 'model.usage', { iteration: 0, usage: { inputTokens: 10 }, totals: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.01 } }),
    ev(2, 'model.usage', { iteration: 1, usage: { inputTokens: 8 }, totals: { inputTokens: 18, outputTokens: 9, totalTokens: 27, costUsd: 0.02 } }),
  ] as never);
  assert.deepEqual(m.usage, { inputTokens: 18, outputTokens: 9, totalTokens: 27, costUsd: 0.02 });
});
