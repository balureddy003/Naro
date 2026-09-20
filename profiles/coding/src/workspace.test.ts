import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAction } from '@naro/core';
import { WorkspaceEnvironment } from './workspace.ts';

const ctx = { agentId: 'a1', goalId: 'g1' };
const act = (capability: string, rel: string, input?: unknown) =>
  createAction('a1', { capability, target: `env://ws/${rel}`, ...(input !== undefined && { input }) });

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'naro-ws-'));
  await writeFile(join(dir, 'hello.txt'), 'world');
  return { env: new WorkspaceEnvironment({ root: dir }, 'ws'), dir };
}

test('fs.read returns file content', async () => {
  const { env, dir } = await workspace();
  try {
    const obs = await env.execute(act('fs.read', 'hello.txt'), ctx);
    assert.equal(obs.success, true);
    assert.equal((obs.output as { content: string }).content, 'world');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fs.write creates files and fs.list sees them', async () => {
  const { env, dir } = await workspace();
  try {
    await env.execute(act('fs.write', 'sub/new.ts', { content: 'export {}' }), ctx);
    const obs = await env.execute(act('fs.list', 'sub'), ctx);
    assert.deepEqual(obs.output, ['new.ts']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('path escapes are jailed — cannot leave the workspace', async () => {
  const { env, dir } = await workspace();
  try {
    const obs = await env.execute(act('fs.read', '../../etc/passwd'), ctx);
    assert.equal(obs.success, false);
    assert.match(obs.error ?? '', /escapes workspace/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('shell.exec runs inside the workspace and returns exit info', async () => {
  const { env, dir } = await workspace();
  try {
    const obs = await env.execute(act('shell.exec', 'shell', { command: 'cat hello.txt' }), ctx);
    assert.equal(obs.success, true);
    const out = obs.output as { exitCode: number; stdout: string };
    assert.equal(out.exitCode, 0);
    assert.equal(out.stdout.trim(), 'world');
    const fail = await env.execute(act('shell.exec', 'shell', { command: 'exit 7' }), ctx);
    assert.equal(fail.success, false);
    assert.match(fail.error ?? '', /exit 7/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('state() exposes the file tree as observable resources', async () => {
  const { env, dir } = await workspace();
  try {
    const s = await env.state();
    assert.ok(((s.resources['files'] as string[]) ?? []).includes('hello.txt'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unsupported capability fails visibly', async () => {
  const { env, dir } = await workspace();
  try {
    const obs = await env.execute(act('network.get', 'x'), ctx);
    assert.equal(obs.success, false);
    assert.match(obs.error ?? '', /does not support/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
