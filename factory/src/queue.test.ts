import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockModel } from '@naro/model';
import { InMemoryRunRegistry } from '@naro/runtime';
import { SoftwareFactory, type FactoryJob } from './queue.ts';

async function withWorkspace<T>(seed: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'naro-factory-'));
  try {
    await writeFile(join(dir, 'greeting.txt'), seed);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

function scriptedRewrite(newContent: string): MockModel {
  return new MockModel({
    responses: [
      { message: { role: 'assistant', content: '', toolCalls: [
        { id: 't1', name: 'read_file', arguments: { path: 'greeting.txt' } },
      ] }, finishReason: 'tool-calls' },
      { message: { role: 'assistant', content: '', toolCalls: [
        { id: 't2', name: 'write_file', arguments: { path: 'greeting.txt', content: newContent } },
      ] }, finishReason: 'tool-calls' },
      { message: { role: 'assistant', content: 'done' }, finishReason: 'stop' },
    ],
  });
}

test('the factory runs two jobs against two different workspaces concurrently, each tracked independently', async () => {
  await withWorkspace('hello\n', async (dirA) => {
    await withWorkspace('hola\n', async (dirB) => {
      const registry = new InMemoryRunRegistry();

      const jobA: FactoryJob = {
        id: 'job-a', repo: 'repo-a', workspaceRoot: dirA,
        task: 'rewrite greeting', verifyCommand: "grep -q 'hello world' greeting.txt",
      };
      const jobB: FactoryJob = {
        id: 'job-b', repo: 'repo-b', workspaceRoot: dirB,
        task: 'rewrite greeting', verifyCommand: "grep -q 'hola mundo' greeting.txt",
      };

      // Each job needs its own scripted model (the content it writes
      // differs), so two factory instances share one registry — the thing
      // that matters is both land in the SAME registry, grouped by repo,
      // not that one factory instance ran both.
      const factoryA = new SoftwareFactory({ cheap: scriptedRewrite('hello world\n'), registry });
      const factoryB = new SoftwareFactory({ cheap: scriptedRewrite('hola mundo\n'), registry });

      const { runId: runIdA } = factoryA.submit(jobA);
      const { runId: runIdB } = factoryB.submit(jobB);
      assert.notEqual(runIdA, runIdB);

      // Poll both to completion — each factory only knows its own job.
      for (let i = 0; i < 100; i++) {
        if (factoryA.status('job-a')?.status !== 'running' && factoryB.status('job-b')?.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 20));
      }

      assert.equal(factoryA.status('job-a')?.status, 'completed');
      assert.equal(factoryB.status('job-b')?.status, 'completed');

      const contentA = await readFile(join(dirA, 'greeting.txt'), 'utf8');
      const contentB = await readFile(join(dirB, 'greeting.txt'), 'utf8');
      assert.equal(contentA, 'hello world\n');
      assert.equal(contentB, 'hola mundo\n');

      // Both jobs land in the SAME shared registry, grouped by repo —
      // the thing that makes this "a factory" rather than two one-offs.
      const runs = await registry.list();
      const runA = runs.find((r) => r.runId === runIdA);
      const runB = runs.find((r) => r.runId === runIdB);
      assert.equal(runA?.specName, 'factory:repo-a:job-a');
      assert.equal(runB?.specName, 'factory:repo-b:job-b');
      assert.equal(runA?.status, 'completed');
      assert.equal(runB?.status, 'completed');
    });
  });
});

test('a job id submitted twice returns the same runId instead of running twice', async () => {
  await withWorkspace('hello\n', async (dir) => {
    const registry = new InMemoryRunRegistry();
    const factory = new SoftwareFactory({ cheap: scriptedRewrite('hello world\n'), registry });
    const job: FactoryJob = { id: 'dup', repo: 'r', workspaceRoot: dir, task: 'x', verifyCommand: 'true' };

    const first = factory.submit(job);
    const second = factory.submit(job);
    assert.equal(first.runId, second.runId);

    for (let i = 0; i < 100 && factory.status('dup')?.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(factory.status('dup')?.status, 'completed');
  });
});

test('a failing verify command surfaces as a failed job, not a silently completed one', async () => {
  await withWorkspace('hello\n', async (dir) => {
    const registry = new InMemoryRunRegistry();
    const model = new MockModel({
      respond: () => ({ message: { role: 'assistant', content: 'done, trust me' }, finishReason: 'stop' }),
    });
    const factory = new SoftwareFactory({ cheap: model, registry });
    const job: FactoryJob = { id: 'bad', repo: 'r', workspaceRoot: dir, task: 'claim without doing', verifyCommand: 'false', maxIterations: 3 };

    factory.submit(job);
    for (let i = 0; i < 100 && factory.status('bad')?.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.notEqual(factory.status('bad')?.status, 'completed');
  });
});
