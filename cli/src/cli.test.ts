import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, resolveServeStore } from './commands.ts';
import { EventBus } from '@naro/runtime';
import { generateSealKeypair, type NaroEvent } from '@naro/core';

/** A real hash-chained journal, straight from the bus. */
function chainedEvents(): NaroEvent[] {
  const bus = new EventBus({ agentId: 'a', goalId: 'g' });
  bus.emit('agent.created', { name: 'x' });
  bus.emit('reasoning.started', { iteration: 0 });
  bus.emit('agent.completed', { result: 'done' });
  return bus.history() as NaroEvent[];
}

function capture() {
  const out: string[] = []; const err: string[] = [];
  return { io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) }, out, err };
}

test('resolveServeStore: no path or url configures nothing', () => {
  assert.equal(resolveServeStore({ sqlitePath: undefined, pgUrlFlag: undefined, sharedPgUrl: undefined }), undefined);
});

test('resolveServeStore: an explicit SQLite path wins over any Pg url', () => {
  const r = resolveServeStore({ sqlitePath: 'runs.db', pgUrlFlag: 'postgres://a', sharedPgUrl: 'postgres://b' });
  assert.deepEqual(r, { kind: 'sqlite', path: 'runs.db' });
});

test('resolveServeStore: a per-store Pg url wins over the shared one', () => {
  const r = resolveServeStore({ sqlitePath: undefined, pgUrlFlag: 'postgres://per-store', sharedPgUrl: 'postgres://shared' });
  assert.deepEqual(r, { kind: 'pg', url: 'postgres://per-store' });
});

test('resolveServeStore: falls back to the shared Pg url (e.g. NARO_PG_URL)', () => {
  const r = resolveServeStore({ sqlitePath: undefined, pgUrlFlag: undefined, sharedPgUrl: 'postgres://shared' });
  assert.deepEqual(r, { kind: 'pg', url: 'postgres://shared' });
});

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
    assert.match(text, /chain=BROKEN journal is not hash-chained/); // legacy events have no hashes
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('verify exits 0 on an intact chain and prints the evidence record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-cli-'));
  try {
    const file = join(dir, 'audit.jsonl');
    await writeFile(file, chainedEvents().map((e) => JSON.stringify(e)).join('\n'));
    const { io, out } = capture();
    assert.equal(await main(['verify', file], io), 0);
    const text = out.join('\n');
    assert.match(text, /chain: OK \(3 chained events/);
    assert.match(text, /outcome: completed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('verify exits 1 on a tampered chain and on unchained journals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-cli-'));
  try {
    const events = chainedEvents();
    const tampered = events.map((e, i) =>
      i === 1 ? ({ ...e, data: { iteration: 999 } } as unknown as NaroEvent) : e);
    const bad = join(dir, 'bad.jsonl');
    await writeFile(bad, tampered.map((e) => JSON.stringify(e)).join('\n'));
    const { io, out } = capture();
    assert.equal(await main(['verify', bad], io), 1);
    assert.match(out.join('\n'), /chain: BROKEN/);

    const legacy = join(dir, 'legacy.jsonl');
    await writeFile(legacy, events.map((e) => {
      const { prev: _p, hash: _h, ...rest } = e;
      return JSON.stringify(rest);
    }).join('\n'));
    assert.equal(await main(['verify', legacy], io), 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('verify --json emits a machine-readable EvidenceRecord', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-cli-'));
  try {
    const file = join(dir, 'audit.jsonl');
    await writeFile(file, chainedEvents().map((e) => JSON.stringify(e)).join('\n'));
    const { io, out } = capture();
    assert.equal(await main(['verify', file, '--json'], io), 0);
    const rec = JSON.parse(out.join('\n')) as { chain: { ok: boolean }; outcome: { status: string } };
    assert.equal(rec.chain.ok, true);
    assert.equal(rec.outcome.status, 'completed');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('verify --pubkey pins the seal key and rejects a mismatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-cli-'));
  try {
    const { privateKeyPem, publicKeyPem } = generateSealKeypair();
    const bus = new EventBus({ agentId: 'a', goalId: 'g' });
    bus.emit('agent.completed', { result: 'x' });
    bus.seal(privateKeyPem);
    const file = join(dir, 'sealed.jsonl');
    await writeFile(file, bus.history().map((e) => JSON.stringify(e)).join('\n'));

    const pub = join(dir, 'seal.pub');
    await writeFile(pub, publicKeyPem);
    const { io, out } = capture();
    assert.equal(await main(['verify', file, '--pubkey', pub], io), 0);
    assert.match(out.join('\n'), /seal: VALID/);

    // A different public key → exit 1.
    const wrong = join(dir, 'wrong.pub');
    await writeFile(wrong, generateSealKeypair().publicKeyPem);
    const { io: io2, err } = capture();
    assert.equal(await main(['verify', file, '--pubkey', wrong], io2), 1);
    assert.match(err.join('\n'), /does not match/);

    // --pubkey on an unsealed journal → exit 1 (nothing to check).
    const unsealed = join(dir, 'unsealed.jsonl');
    await writeFile(unsealed, chainedEvents().map((e) => JSON.stringify(e)).join('\n'));
    const { io: io3 } = capture();
    assert.equal(await main(['verify', unsealed, '--pubkey', pub], io3), 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('verify without a file exits 2', async () => {
  const { io, err } = capture();
  assert.equal(await main(['verify'], io), 2);
  assert.match(err.join('\n'), /usage: naro verify/);
});

test('bench runs a module exporting EvalCase[]', async () => {
  const { io, out } = capture();
  const code = await main(['bench', join(import.meta.dirname, '../fixtures/sample-bench.ts')], io);
  assert.equal(code, 0);
  assert.match(out.join('\n'), /trivial/);
});

test('bench --baseline gates on regressions, --save persists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-cli-'));
  try {
    const store = join(dir, 'base.jsonl');
    const baseline = {
      at: 0, label: 'v1',
      report: { total: 1, passed: 1, failed: 0, passRate: 1,
        results: [{ caseId: 'trivial', ok: true, status: 'completed',
          metrics: { totalEvents: 0, iterations: 0, actionsRequested: 0, actionsDenied: 0,
            approvalsRequested: 0, observations: 0, verifications: { total: 0, passed: 0, failed: 0 },
            replans: 0, checkpoints: 0, durationMs: 0 } }],
        totals: { iterations: 0, actionsRequested: 0, actionsDenied: 0, replans: 0, durationMs: 0 } },
    };
    await writeFile(store, JSON.stringify(baseline) + '\n');

    // same caseId now fails → regression → exit 1
    const { io, out } = capture();
    const code = await main(['bench', join(import.meta.dirname, '../fixtures/failing-bench.ts'), '--baseline', store], io);
    assert.equal(code, 1);
    assert.match(out.join('\n'), /REGRESSED trivial/);

    // --save appends a stored report
    const code2 = await main(['bench', join(import.meta.dirname, '../fixtures/sample-bench.ts'), '--save', store, '--label', 'v2'], io);
    assert.equal(code2, 0);
    const lines = (await readFile(store, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]!).label, 'v2');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unknown command exits 2 with help', async () => {
  const { io, err } = capture();
  assert.equal(await main(['frobnicate'], io), 2);
  assert.match(err.join('\n'), /naro run/);
});
