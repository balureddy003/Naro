import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAction } from '@naro/core';
import { ToolExecutor, ToolRegistry } from '@naro/tools';
import { WorkspaceEnvironment } from './workspace.ts';
import { codingTools } from './tools.ts';

const ctx = { agentId: 'a1', goalId: 'g1', permissions: ['fs.read', 'fs.write', 'shell.exec'] };

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'naro-tools-'));
  await writeFile(join(dir, 'x.txt'), 'data');
  const env = new WorkspaceEnvironment({ root: dir }, 'ws');
  const registry = new ToolRegistry();
  for (const t of codingTools(env)) registry.register(t);
  return { registry, dir };
}

const act = (name: string, input: unknown) =>
  createAction('a1', { capability: 'tool.invoke', target: `tool://${name}`, input });

test('coding tools execute through the standard pipeline', async () => {
  const { registry, dir } = await setup();
  try {
    const exec = new ToolExecutor(registry);
    const read = await exec.execute(act('read_file', { path: 'x.txt' }), ctx);
    assert.equal((read.output as { content: string }).content, 'data');
    const run = await exec.execute(act('run_command', { command: 'cat x.txt' }), ctx);
    assert.equal((run.output as { stdout: string }).stdout.trim(), 'data');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tools inherit the jail — escapes fail through the pipeline', async () => {
  const { registry, dir } = await setup();
  try {
    const obs = await new ToolExecutor(registry).execute(act('read_file', { path: '../../etc/passwd' }), ctx);
    assert.equal(obs.success, false);
    assert.match(obs.error ?? '', /escapes workspace/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tool metadata declares honest side effects', async () => {
  const { registry, dir } = await setup();
  try {
    assert.equal(registry.get('read_file')?.sideEffects, 'read');
    assert.equal(registry.get('write_file')?.sideEffects, 'write');
    assert.equal(registry.get('run_command')?.sideEffects, 'destructive');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
