import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Action } from '@naro/core';
import { MockModel } from '@naro/model';
import { AgentRunner, type HumanBridge } from '@naro/runtime';
import { codeChangeTemplate, type CodeChangeInput } from './code-change.ts';

async function withWorkspace<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'naro-code-change-'));
  try {
    await writeFile(join(dir, 'greeting.txt'), 'hello\n');
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

test('a read-then-write change completes, verified by a real command that depends on the actual file content', async () => {
  await withWorkspace(async (dir) => {
    const model = new MockModel({
      responses: [
        { message: { role: 'assistant', content: '', toolCalls: [
          { id: 't1', name: 'read_file', arguments: { path: 'greeting.txt' } },
        ] }, finishReason: 'tool-calls' },
        { message: { role: 'assistant', content: '', toolCalls: [
          { id: 't2', name: 'write_file', arguments: { path: 'greeting.txt', content: 'hello world\n' } },
        ] }, finishReason: 'tool-calls' },
        { message: { role: 'assistant', content: 'Changed the greeting to include "world".' }, finishReason: 'stop' },
      ],
    });

    const input: CodeChangeInput = {
      task: 'Change greeting.txt so it reads "hello world" instead of "hello".',
      workspaceRoot: dir,
      // Fails unless the file was actually rewritten — proves the verifier
      // is checking real workspace state, not rubber-stamping completion.
      verifyCommand: "grep -q 'hello world' greeting.txt",
    };
    const deps = codeChangeTemplate.build(input, { cheap: model });
    const runner = new AgentRunner(deps);
    const result = await runner.run();

    assert.equal(result.status, 'completed');
    const onDisk = await readFile(join(dir, 'greeting.txt'), 'utf8');
    assert.equal(onDisk, 'hello world\n');

    const verification = result.events.find((e) => e.type === 'verification.completed');
    assert.ok(verification, 'expected a verification.completed event');
    assert.equal((verification!.data as { ok: boolean }).ok, true);
  });
});

test('a destructive action (run_command) requires approval before the run can complete', async () => {
  await withWorkspace(async (dir) => {
    const model = new MockModel({
      responses: [
        { message: { role: 'assistant', content: '', toolCalls: [
          { id: 't1', name: 'run_command', arguments: { command: 'cat greeting.txt' } },
        ] }, finishReason: 'tool-calls' },
        { message: { role: 'assistant', content: 'Read it via the shell.' }, finishReason: 'stop' },
      ],
    });

    let approveCalledWith: Action | undefined;
    const approvals: HumanBridge = {
      approve: (action) => {
        approveCalledWith = action;
        return Promise.resolve({ approved: true, by: 'test-reviewer' });
      },
      ask: () => Promise.resolve(''),
    };

    const input: CodeChangeInput = {
      task: 'Print greeting.txt via the shell.',
      workspaceRoot: dir,
      verifyCommand: 'true',
    };
    const deps = codeChangeTemplate.build(input, { cheap: model });
    const runner = new AgentRunner({ ...deps, human: approvals });
    const result = await runner.run();

    assert.equal(result.status, 'completed');
    // The gate actually fired — every tool action carries the generic
    // 'tool.invoke' capability; the specific tool lives in the target.
    assert.equal(approveCalledWith?.target, 'tool://run_command');
  });
});

test('a failing verify command blocks completion — the command decides, not the model\'s claim', async () => {
  await withWorkspace(async (dir) => {
    const model = new MockModel({
      respond: () => ({ message: { role: 'assistant', content: 'Done, nothing to change.' }, finishReason: 'stop' }),
    });

    const input: CodeChangeInput = {
      task: 'Claim completion without doing anything.',
      workspaceRoot: dir,
      verifyCommand: 'false', // always fails — no task output could satisfy this
      maxIterations: 3,
    };
    const deps = codeChangeTemplate.build(input, { cheap: model });
    const runner = new AgentRunner(deps);
    const result = await runner.run();

    assert.notEqual(result.status, 'completed');
    const verification = result.events.find((e) => e.type === 'verification.completed');
    assert.ok(verification, 'expected a verification.completed event');
    assert.equal((verification!.data as { ok: boolean }).ok, false);
  });
});
