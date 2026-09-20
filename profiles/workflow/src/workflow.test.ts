import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, type ExecContext } from '@naro/core';
import { InMemoryEnvironment } from '@naro/environment';
import { WorkflowEnvironment, validateWorkflow } from './index.ts';

const ctx: ExecContext = { agentId: 'a', goalId: 'g' };
const act = (cap: string, input: unknown) =>
  createAction('a', { capability: cap, target: `env://wf/${cap}`, input });

const kv = () => new InMemoryEnvironment(); // env.get / env.set capabilities — key comes from target
const wf = () => new WorkflowEnvironment({ executor: kv() });

test('validate catches cycles, unknown deps, dup ids', () => {
  assert.deepEqual(validateWorkflow({ steps: [
    { id: 'a', capability: 'x', dependsOn: ['b'] },
    { id: 'b', capability: 'x', dependsOn: ['a'] },
  ] }).some((e) => e.includes('cycle')), true);
  assert.ok(validateWorkflow({ steps: [{ id: 'a', capability: 'x', dependsOn: ['ghost'] }] })[0]!.includes('unknown'));
  assert.ok(validateWorkflow({ steps: [{ id: 'a', capability: 'x' }, { id: 'a', capability: 'x' }] })[0]!.includes('duplicate'));
  assert.deepEqual(validateWorkflow({ steps: [{ id: 'a', capability: 'x' }] }), []);
});

test('run executes in dependency order and resolves $refs', async () => {
  const o = await wf().execute(act('workflow.run', { spec: { steps: [
    { id: 'write', capability: 'env.set', target: 'env://mem/greeting', input: 'hello' },
    { id: 'read', capability: 'env.get', target: 'env://mem/greeting', dependsOn: ['write'] },
    { id: 'write2', capability: 'env.set', target: 'env://mem/echo', input: '$read', dependsOn: ['read'] },
    { id: 'read2', capability: 'env.get', target: 'env://mem/echo', dependsOn: ['write2'] },
  ] } }), ctx);
  assert.equal(o.success, true);
  const r = o.output as { completed: string[]; outputs: Record<string, unknown> };
  assert.deepEqual(r.completed, ['write', 'read', 'write2', 'read2']);
  assert.equal(r.outputs['read2'], 'hello'); // ref chained through two steps
});

test('failing step halts the run and reports honestly', async () => {
  const o = await wf().execute(act('workflow.run', { spec: { steps: [
    { id: 'good', capability: 'env.set', target: 'env://mem/k', input: 1 },
    { id: 'bad', capability: 'nope.missing', dependsOn: ['good'] },
    { id: 'never', capability: 'env.set', target: 'env://mem/x', input: 2, dependsOn: ['bad'] },
  ] } }), ctx);
  const r = o.output as { completed: string[]; failed: { id: string } };
  assert.deepEqual(r.completed, ['good']);
  assert.equal(r.failed.id, 'bad');
});

test('retries give flaky steps their attempts', async () => {
  let calls = 0;
  const flaky = { execute: async () => {
    calls++;
    return calls < 3
      ? { id: 'o', at: 0, actionId: 'a', source: 'x', kind: 'env-change' as const, success: false, error: 'flaky' }
      : { id: 'o', at: 0, actionId: 'a', source: 'x', kind: 'env-change' as const, success: true, output: 'done' };
  } };
  const env = new WorkflowEnvironment({ executor: flaky });
  const o = await env.execute(act('workflow.run', { spec: { steps: [
    { id: 's', capability: 'anything', retries: 2 },
  ] } }), ctx);
  assert.equal(calls, 3);
  assert.deepEqual((o.output as { completed: string[] }).completed, ['s']);
});
