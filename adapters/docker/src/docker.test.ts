import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, createGoal, createObservation } from '@naro/core';
import { DockerSandboxExecutor } from './docker.ts';
import type { SpawnFn } from './spawn.ts';

const action = createAction('a1', { capability: 'tool.invoke', target: 'tool://calc', input: { n: 1 } });
const ctx = { agentId: 'ag1', goalId: 'g1', goal: createGoal({ description: 'g' }), grants: [] };

function fakeSpawn(impl: (command: string, args: readonly string[], input: string) => {
  stdout?: string; stderr?: string; exitCode?: number | null; timedOut?: boolean;
}): { spawn: SpawnFn; calls: { command: string; args: readonly string[]; input: string }[] } {
  const calls: { command: string; args: readonly string[]; input: string }[] = [];
  const spawn: SpawnFn = (command, args, opts) => {
    calls.push({ command, args, input: opts.input });
    const r = impl(command, args, opts.input);
    return Promise.resolve({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode ?? 0, timedOut: r.timedOut ?? false });
  };
  return { spawn, calls };
}

test('a successful container run round-trips the observation', async () => {
  const observation = createObservation({ actionId: action.id, source: action.target, kind: 'tool-result', success: true, output: 42 });
  const { spawn } = fakeSpawn(() => ({ stdout: JSON.stringify({ ok: true, observation }) + '\n' }));
  const executor = new DockerSandboxExecutor({ image: 'naro-sandbox:latest', spawn });
  const result = await executor.execute(action, ctx);
  assert.equal(result.success, true);
  assert.equal(result.output, 42);
});

test('the action and safe ctx are sent as one JSON line on stdin', async () => {
  const { spawn, calls } = fakeSpawn(() => ({
    stdout: JSON.stringify({ ok: true, observation: createObservation({ actionId: action.id, source: action.target, kind: 'tool-result', success: true }) }),
  }));
  const executor = new DockerSandboxExecutor({ image: 'img', spawn });
  await executor.execute(action, { ...ctx, secrets: { resolve: async () => 'shh' } });
  const sent = JSON.parse(calls[0]!.input) as { action: { id: string }; ctx: Record<string, unknown> };
  assert.equal(sent.action.id, action.id);
  assert.equal(sent.ctx['secrets'], undefined); // live callbacks never cross the process boundary
});

test('default docker run args apply network=none, read-only, and resource caps', async () => {
  const { spawn, calls } = fakeSpawn(() => ({
    stdout: JSON.stringify({ ok: true, observation: createObservation({ actionId: action.id, source: action.target, kind: 'tool-result', success: true }) }),
  }));
  const executor = new DockerSandboxExecutor({ image: 'my-image', spawn });
  await executor.execute(action, ctx);
  const args = calls[0]!.args;
  assert.ok(args.includes('--network=none'));
  assert.ok(args.includes('--read-only'));
  assert.ok(args.includes('--cap-drop=ALL'));
  assert.ok(args.includes('--memory=256m'));
  assert.ok(args.includes('--pids-limit=128'));
  assert.equal(args.at(-1), 'my-image');
});

test('options and extraArgs override the defaults without dropping them', async () => {
  const { spawn, calls } = fakeSpawn(() => ({
    stdout: JSON.stringify({ ok: true, observation: createObservation({ actionId: action.id, source: action.target, kind: 'tool-result', success: true }) }),
  }));
  const executor = new DockerSandboxExecutor({
    image: 'my-image', network: 'bridge', memory: '512m', extraArgs: ['-v', '/data:/data:ro'], spawn,
  });
  await executor.execute(action, ctx);
  const args = calls[0]!.args;
  assert.ok(args.includes('--network=bridge'));
  assert.ok(args.includes('--memory=512m'));
  assert.ok(args.includes('-v'));
  assert.ok(args.includes('/data:/data:ro'));
});

test('a timed-out container produces a failed observation, not a hang', async () => {
  const { spawn } = fakeSpawn(() => ({ timedOut: true, exitCode: null }));
  const executor = new DockerSandboxExecutor({ image: 'img', timeoutMs: 5, spawn });
  const result = await executor.execute(action, ctx);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /timeout/);
});

test('a non-zero exit surfaces stderr in the failure', async () => {
  const { spawn } = fakeSpawn(() => ({ exitCode: 1, stderr: 'permission denied inside container' }));
  const executor = new DockerSandboxExecutor({ image: 'img', spawn });
  const result = await executor.execute(action, ctx);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /permission denied/);
});

test('a container that violates the stdout JSON contract fails loudly, not silently', async () => {
  const { spawn } = fakeSpawn(() => ({ stdout: 'not json at all' }));
  const executor = new DockerSandboxExecutor({ image: 'img', spawn });
  const result = await executor.execute(action, ctx);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /JSON contract/);
});

test('{ok: false, error} from the container becomes the observation error', async () => {
  const { spawn } = fakeSpawn(() => ({ stdout: JSON.stringify({ ok: false, error: 'tool blew up' }) }));
  const executor = new DockerSandboxExecutor({ image: 'img', spawn });
  const result = await executor.execute(action, ctx);
  assert.equal(result.success, false);
  assert.equal(result.error, 'tool blew up');
});

test('startup noise before the contract line is ignored — the last line wins', async () => {
  const observation = createObservation({ actionId: action.id, source: action.target, kind: 'tool-result', success: true, output: 'ok' });
  const { spawn } = fakeSpawn(() => ({
    stdout: `Pulling image layers...\nWarming up runtime...\n${JSON.stringify({ ok: true, observation })}\n`,
  }));
  const executor = new DockerSandboxExecutor({ image: 'img', spawn });
  const result = await executor.execute(action, ctx);
  assert.equal(result.success, true);
  assert.equal(result.output, 'ok');
});

test('a spawn that throws (docker not installed) fails the observation, not the process', async () => {
  const spawn: SpawnFn = () => Promise.reject(new Error('ENOENT: docker not found'));
  const executor = new DockerSandboxExecutor({ image: 'img', spawn });
  const result = await executor.execute(action, ctx);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /docker spawn failed/);
});
