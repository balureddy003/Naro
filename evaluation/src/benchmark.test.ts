import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal, createObservation, type ActionExecutor } from '@naro/core';
import { DirectReasoner } from '@naro/runtime';
import { BenchmarkRunner, formatReport } from './benchmark.ts';

const echo: ActionExecutor = {
  execute: (a) => Promise.resolve(createObservation({ actionId: a.id, source: a.target, kind: 'env-change', success: true, output: a.input })),
};

const succeed = (answer: string) => ({
  reasoner: new DirectReasoner((ctx) =>
    ctx.observations.length === 0
      ? { kind: 'act', action: { capability: 'env.set', target: 'env://local/k', input: answer } } as never
      : { kind: 'complete', result: answer }),
  executor: echo,
});

const failer = {
  reasoner: new DirectReasoner(() => ({ kind: 'fail', reason: 'cannot' })),
  executor: echo,
};

test('benchmark runs cases, scores outcomes, aggregates metrics', async () => {
  const report = await new BenchmarkRunner().run([
    { id: 'case-a', goal: createGoal({ description: 'a' }), deps: succeed('yes') },
    { id: 'case-b', goal: createGoal({ description: 'b' }), deps: failer,
      check: (r) => ({ ok: r.status === 'failed', reason: 'expected failure' }) },
    { id: 'case-c', goal: createGoal({ description: 'c' }), deps: succeed('no'),
      check: (r) => r.result === 'yes' },
  ]);

  assert.equal(report.total, 3);
  assert.equal(report.passed, 2);  // case-b passes its check (expected failure)
  assert.ok(report.passRate > 0.6 && report.passRate < 0.7);
  assert.ok(report.totals.actionsRequested >= 2);
  const text = formatReport(report);
  assert.match(text, /2\/3 passed/);
});
