import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpawn } from './spawn.ts';

test('defaultSpawn writes stdin, captures stdout/stderr, and reports the exit code', async () => {
  const result = await defaultSpawn('node', ['-e', 'process.stdin.pipe(process.stdout)'], {
    input: 'hello from stdin',
    timeoutMs: 5_000,
  });
  assert.equal(result.stdout, 'hello from stdin');
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
});

test('defaultSpawn kills a hung process at the timeout instead of waiting forever', async () => {
  const result = await defaultSpawn('node', ['-e', 'setInterval(() => {}, 1000)'], {
    input: '',
    timeoutMs: 100,
  });
  assert.equal(result.timedOut, true);
});

test('defaultSpawn resolves (does not throw) when the binary does not exist', async () => {
  const result = await defaultSpawn('naro-definitely-not-a-real-binary', [], { input: '', timeoutMs: 2_000 });
  assert.equal(result.exitCode, null);
  assert.ok(result.stderr.length > 0);
});
