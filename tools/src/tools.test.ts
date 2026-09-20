import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction } from '@naro/core';
import { ToolRegistry } from './registry.ts';
import { ToolExecutor } from './executor.ts';
import { createToolPolicy } from './policy.ts';
import type { Tool } from './tool.ts';

const calculator: Tool = {
  name: 'calculator',
  description: 'adds two numbers',
  inputSchema: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
    additionalProperties: false,
  },
  outputSchema: { type: 'number' },
  permissions: [],
  sideEffects: 'none',
  execute: (input) => {
    const { a, b } = input as { a: number; b: number };
    return Promise.resolve(a + b);
  },
};

const rmrf: Tool = {
  name: 'delete-everything',
  description: 'irreversibly deletes data',
  inputSchema: { type: 'object' },
  permissions: ['fs.delete'],
  sideEffects: 'destructive',
  execute: () => Promise.resolve('gone'),
};

const exec = (t: ToolExecutor, target: string, input: unknown) =>
  t.execute(createAction('agent_1', { capability: 'tool.invoke', target, input }), {
    agentId: 'agent_1', goalId: 'goal_1',
  });

test('happy path: resolve → validate → execute → observe', async () => {
  const registry = new ToolRegistry().register(calculator);
  const obs = await exec(new ToolExecutor(registry), 'tool://calculator', { a: 2, b: 3 });
  assert.equal(obs.success, true);
  assert.equal(obs.output, 5);
  assert.equal(obs.kind, 'tool-result');
});

test('unknown tool produces a failed observation', async () => {
  const obs = await exec(new ToolExecutor(new ToolRegistry()), 'tool://nope', {});
  assert.equal(obs.success, false);
  assert.match(obs.error ?? '', /unknown tool/);
});

test('invalid input is rejected before execute runs', async () => {
  let ran = false;
  const tool = { ...calculator, execute: () => { ran = true; return Promise.resolve(0); } };
  const obs = await exec(new ToolExecutor(new ToolRegistry().register(tool)), 'tool://calculator', { a: 'x' });
  assert.equal(obs.success, false);
  assert.equal(ran, false);
});

test('output contract breaches are caught too', async () => {
  const bad = { ...calculator, execute: () => Promise.resolve('not a number') };
  const obs = await exec(new ToolExecutor(new ToolRegistry().register(bad)), 'tool://calculator', { a: 1, b: 2 });
  assert.equal(obs.success, false);
  assert.match(obs.error ?? '', /output contract/);
});

test('policy: missing permissions deny; destructive requires approval', () => {
  const registry = new ToolRegistry().register(calculator).register(rmrf);
  const policy = createToolPolicy(registry);
  const ctx = { agentId: 'a', goal: { id: 'g' } as never, grants: [] };

  const calcAction = createAction('a', { capability: 'tool.invoke', target: 'tool://calculator', input: { a: 1, b: 2 } });
  assert.equal(policy.evaluate(calcAction, ctx), 'allow');

  const rmAction = createAction('a', { capability: 'tool.invoke', target: 'tool://delete-everything' });
  assert.equal(policy.evaluate(rmAction, ctx), 'deny'); // missing fs.delete

  assert.equal(policy.evaluate(rmAction, { ...ctx, grants: ['fs.delete'] }), 'require_approval');
});

test('ToolSource discovery populates the registry', async () => {
  const registry = new ToolRegistry();
  registry.addSource({ id: 'local', discover: () => [calculator] });
  await registry.refresh();
  assert.ok(registry.has('calculator'));
});
