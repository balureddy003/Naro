import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './commands.ts';

function capture() {
  const out: string[] = []; const err: string[] = [];
  return { io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) }, out, err };
}

test('states prints the full transition table', async () => {
  const { io, out } = capture();
  assert.equal(await main(['states'], io), 0);
  assert.match(out.join('\n'), /REASONING.*WAITING_FOR_PERMISSION/);
  assert.match(out.join('\n'), /COMPLETED.*terminal/);
});

test('replay summarizes a JSONL audit stream', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-cli-'));
  try {
    const file = join(dir, 'audit.jsonl');
    const evs = [
      { id: 'e1', type: 'agent.created', seq: 1, at: 1000, agentId: 'a', goalId: 'g', data: { name: 'x' } },
      { id: 'e2', type: 'reasoning.started', seq: 2, at: 1100, agentId: 'a', goalId: 'g', data: { iteration: 0 } },
      { id: 'e3', type: 'action.denied', seq: 3, at: 1200, agentId: 'a', goalId: 'g', data: { action: {}, reason: 'no' } },
      { id: 'e4', type: 'agent.completed', seq: 4, at: 1500, agentId: 'a', goalId: 'g', data: { result: 1 } },
    ];
    await writeFile(file, evs.map((e) => JSON.stringify(e)).join('\n'));
    const { io, out } = capture();
    assert.equal(await main(['replay', file], io), 0);
    const text = out.join('\n');
    assert.match(text, /\[3\] a action.denied/);
    assert.match(text, /denied=1/);
    assert.match(text, /duration=500ms/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bench runs a module exporting EvalCase[]', async () => {
  const { io, out } = capture();
  const code = await main(['bench', join(import.meta.dirname, '../fixtures/sample-bench.ts')], io);
  assert.equal(code, 0);
  assert.match(out.join('\n'), /trivial/);
});

test('unknown command exits 2 with help', async () => {
  const { io, err } = capture();
  assert.equal(await main(['frobnicate'], io), 2);
  assert.match(err.join('\n'), /naro run/);
});
