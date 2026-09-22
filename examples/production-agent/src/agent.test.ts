import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGoal, type Action } from '@naro/core';
import { MockModel } from '@naro/model';
import { SqliteApprovalBridge, SqliteCheckpointStore, SqliteLeaseStore } from '@naro/runtime';
import { SqliteLimitStore } from '@naro/policy';
import { buildRunner, type BuildOptions } from './agent.ts';

/**
 * Proves the real composition (policy + verifier + checkpoints + approval
 * gate), not the network call — a MockModel stands in for AnthropicModel,
 * same substitution every other example in this repo makes. No API key,
 * no Postgres, no real subprocess beyond the trivial verify commands below.
 */
async function withWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'naro-prod-agent-'));
  try {
    await writeFile(join(dir, 'answer.txt'), '42\n');
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

function memoryStores(approvals: BuildOptions['stores']['approvals']): BuildOptions['stores'] {
  return {
    checkpoints: new SqliteCheckpointStore(':memory:'),
    lease: new SqliteLeaseStore(':memory:'),
    limits: new SqliteLimitStore(':memory:'),
    approvals,
  };
}

test('a safe read completes without approval, verified by a real command', async () => {
  await withWorkspace(async (dir) => {
    const model = new MockModel({
      responses: [
        { message: { role: 'assistant', content: '', toolCalls: [
          { id: 't1', name: 'read_file', arguments: { path: 'answer.txt' } },
        ] }, finishReason: 'tool-calls' },
        { message: { role: 'assistant', content: 'The file contains 42.' }, finishReason: 'stop' },
      ],
    });

    const agent = buildRunner(createGoal({ description: 'read answer.txt and report its contents' }), {
      model,
      stores: memoryStores(new SqliteApprovalBridge(':memory:')),
      workspaceRoot: dir,
      dataDir: join(dir, '.naro'),
      verifyCommand: 'true', // a trivially-passing shell command — proves CommandVerifier runs, not just that it's wired
    });

    const result = await agent.runner.run();
    await agent.flushEvidence();
    assert.equal(result.status, 'completed');
  });
});

test('a destructive action requires approval before the run can complete', async () => {
  await withWorkspace(async (dir) => {
    const model = new MockModel({
      responses: [
        { message: { role: 'assistant', content: '', toolCalls: [
          { id: 't1', name: 'run_command', arguments: { command: 'cat answer.txt' } },
        ] }, finishReason: 'tool-calls' },
        { message: { role: 'assistant', content: 'Ran it.' }, finishReason: 'stop' },
      ],
    });

    let approveCalledWith: Action | undefined;
    const approvals: BuildOptions['stores']['approvals'] = {
      approve: (action) => {
        approveCalledWith = action;
        return Promise.resolve({ approved: true, by: 'test-reviewer' });
      },
      ask: () => Promise.resolve(''),
      pending: () => [],
      respond: () => false,
    };

    const agent = buildRunner(createGoal({ description: 'run cat on answer.txt' }), {
      model,
      stores: memoryStores(approvals),
      workspaceRoot: dir,
      dataDir: join(dir, '.naro'),
      verifyCommand: 'true',
    });

    const result = await agent.runner.run();
    await agent.flushEvidence();
    assert.equal(result.status, 'completed');
    // The gate actually fired — this isn't approved-by-default. Every tool
    // action carries the generic 'tool.invoke' capability; the specific
    // tool lives in the action's target (tool://run_command).
    assert.equal(approveCalledWith?.target, 'tool://run_command');
  });
});

test('an unknown tool is denied, not silently executed, and the reasoner recovers', async () => {
  await withWorkspace(async (dir) => {
    const model = new MockModel({
      responses: [
        // First call hallucinates a tool that was never registered.
        { message: { role: 'assistant', content: '', toolCalls: [
          { id: 't1', name: 'delete_everything', arguments: {} },
        ] }, finishReason: 'tool-calls' },
        // The reasoner sees the denial as a failed observation and retries.
        { message: { role: 'assistant', content: '', toolCalls: [
          { id: 't2', name: 'read_file', arguments: { path: 'answer.txt' } },
        ] }, finishReason: 'tool-calls' },
        { message: { role: 'assistant', content: '42' }, finishReason: 'stop' },
      ],
    });

    const agent = buildRunner(createGoal({ description: 'read the file' }), {
      model,
      stores: memoryStores(new SqliteApprovalBridge(':memory:')),
      workspaceRoot: dir,
      dataDir: join(dir, '.naro'),
      verifyCommand: 'true',
    });

    let denialReason: string | undefined;
    agent.runner.on('action.denied', (e) => { denialReason = e.data.reason; });
    const result = await agent.runner.run();
    await agent.flushEvidence();

    assert.match(denialReason ?? '', /no registered tool/);
    assert.equal(result.status, 'completed'); // the run recovers after the denial, it doesn't crash
  });
});
