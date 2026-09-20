import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal, createAction, type ExecContext } from '@naro/core';
const GOAL = createGoal({ description: 'test goal' });
import { DevOpsEnvironment, probeServer } from './index.ts';

const ctx: ExecContext = { agentId: 'a', goalId: 'g' , goal: GOAL, grants: []};
const act = (cap: string, input: unknown) =>
  createAction('a', { capability: cap, target: `env://ops/${cap}`, input });

const env = new DevOpsEnvironment({
  tasks: [
    { name: 'echo.deploy', description: 'fake deploy', argv: ['echo', 'deploying {svc} to {env}'], params: { svc: '^[a-z-]+$', env: '^(staging|prod)$' }, sideEffects: 'destructive' },
    { name: 'version', description: 'runtime version', argv: ['node', '--version'], sideEffects: 'read' },
  ],
});

test('runbook.list inventories declared tasks', async () => {
  const o = await env.execute(act('runbook.list', {}), ctx);
  assert.equal(o.success, true);
  const tasks = o.output as { name: string; params: string[] }[];
  assert.deepEqual(tasks.map((t) => t.name).sort(), ['echo.deploy', 'version']);
  assert.deepEqual(tasks.find((t) => t.name === 'echo.deploy')!.params.sort(), ['env', 'svc']);
});

test('runbook.run executes declared argv with validated params', async () => {
  const o = await env.execute(act('runbook.run', { name: 'version' }), ctx);
  assert.equal(o.success, true);
  assert.match((o.output as { stdout: string }).stdout, /^v\d+/);
  const d = await env.execute(act('runbook.run', { name: 'echo.deploy', params: { svc: 'api', env: 'staging' } }), ctx);
  assert.equal((d.output as { stdout: string }).stdout, 'deploying api to staging');
});

test('params failing their pattern are refused before spawn', async () => {
  const o = await env.execute(act('runbook.run', { name: 'echo.deploy', params: { svc: 'api; rm -rf /', env: 'staging' } }), ctx);
  assert.equal(o.success, false);
  assert.match(o.error ?? '', /failed pattern/);
  const u = await env.execute(act('runbook.run', { name: 'nope' }), ctx);
  assert.equal(u.success, false);
});

test('probe.http honors the host allowlist', async () => {
  const srv = await probeServer();
  const env2 = new DevOpsEnvironment({ tasks: [], probeAllowlist: ['127.0.0.1:' + new URL(srv.url).port] });
  const ok = await env2.execute(act('probe.http', { url: srv.url }), ctx);
  assert.deepEqual(ok.output as object, { status: 200, ok: true, latencyMs: (ok.output as { latencyMs: number }).latencyMs });
  const denied = await env2.execute(act('probe.http', { url: 'http://evil.example/' }), ctx);
  assert.equal(denied.success, false);
  await srv.close();
});
