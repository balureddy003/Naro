import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, type ExecContext, type Goal } from '@naro/core';
import { SandboxedExecutor } from './sandbox.ts';

const goal: Goal = { id: 'g1', description: 'test', constraints: [], successCriteria: [], priority: 1, metadata: {} };
const ctx: ExecContext = { agentId: 'a1', goalId: 'g1', goal, grants: [] };
const act = (target: string, input: unknown = {}) =>
  createAction('a1', { capability: target, target, input });

const fixture = new URL('./sandbox-fixture.ts', import.meta.url).href;

test('executes in a worker and returns the observation', async () => {
  const sandbox = new SandboxedExecutor({ module: fixture });
  const obs = await sandbox.execute(act('tool://echo', { hi: 1 }), ctx);
  assert.equal(obs.success, true);
  assert.deepEqual(obs.output, { echo: { hi: 1 } });
});

test('tool errors inside the sandbox become failed observations', async () => {
  const sandbox = new SandboxedExecutor({ module: fixture });
  const obs = await sandbox.execute(act('tool://boom'), ctx);
  assert.equal(obs.success, false);
  assert.match(obs.error!, /exploded/);
});

test('timeout terminates the worker — a hung tool cannot hang the run', async () => {
  const sandbox = new SandboxedExecutor({ module: fixture, timeoutMs: 200 });
  const start = Date.now();
  const obs = await sandbox.execute(act('tool://hang'), ctx);
  assert.equal(obs.success, false);
  assert.match(obs.error!, /timeout/);
  assert.ok(Date.now() - start < 5000, 'must not wait for the hung tool');
});

test('abort terminates the worker', async () => {
  const sandbox = new SandboxedExecutor({ module: fixture, timeoutMs: 60_000 });
  const ctrl = new AbortController();
  const p = sandbox.execute(act('tool://hang'), { ...ctx, signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 50);
  const obs = await p;
  assert.equal(obs.success, false);
  assert.match(obs.error!, /aborted|terminated/);
});

test('a crash in one action does not affect the next — fresh worker each call', async () => {
  const sandbox = new SandboxedExecutor({ module: fixture });
  const bad = await sandbox.execute(act('tool://boom'), ctx);
  assert.equal(bad.success, false);
  const good = await sandbox.execute(act('tool://echo', { still: 'alive' }), ctx);
  assert.equal(good.success, true);
});
