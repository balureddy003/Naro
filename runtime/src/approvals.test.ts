import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAction } from '@naro/core';
import { SqliteApprovalBridge } from './approvals.ts';

const action = () => createAction('a1', { capability: 'env.write', target: 'env://local/k' });

async function withBridge<T>(fn: (bridge: SqliteApprovalBridge, dbPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'naro-appr-'));
  const dbPath = join(dir, 'approvals.db');
  const bridge = new SqliteApprovalBridge(dbPath, { pollMs: 10 });
  try {
    return await fn(bridge, dbPath);
  } finally {
    bridge.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('respond writes answered_by; approve() returns it as by', async () => {
  await withBridge(async (bridge) => {
    const pending = bridge.approve(action()); // parks until answered
    const [req] = bridge.pending();
    assert.ok(req, 'request should be pending');
    assert.ok(req.expiresAt > Date.now());

    assert.equal(bridge.respond(req!.id, { approved: true, note: 'ok' }, 'alice'), true);
    const res = await pending;
    assert.equal(res.approved, true);
    assert.equal(res.by, 'alice');
    assert.equal(res.note, 'ok');
  });
});

test('expired requests are not pending and cannot be answered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-appr-'));
  try {
    const bridge = new SqliteApprovalBridge(join(dir, 'a.db'), { pollMs: 5, timeoutMs: 30 });
    const waiting = bridge.approve(action()); // will resolve denied at deadline
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(bridge.pending().length, 1);
    const id = bridge.pending()[0]!.id;

    await new Promise((r) => setTimeout(r, 40)); // past expires_at
    assert.equal(bridge.pending().length, 0, 'expired rows are not pending');
    assert.equal(bridge.respond(id, { approved: true }, 'alice'), false, 'expired rows refuse answers');

    const res = await waiting; // the parked caller resolves denied on timeout
    assert.equal(res.approved, false);
    assert.equal(res.by, undefined);
    bridge.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prune deletes answered rows older than the cutoff, keeps the rest', async () => {
  await withBridge(async (bridge, dbPath) => {
    const p1 = bridge.approve(action());
    const p2 = bridge.approve(action());
    const rows = bridge.pending();
    bridge.respond(rows[0]!.id, { approved: true });
    bridge.respond(rows[1]!.id, { approved: false });
    await Promise.all([p1, p2]);

    const db = new DatabaseSync(dbPath); // second connection — WAL allows it
    try {
      // Age one row; the other is fresh.
      db.prepare('UPDATE approvals SET answered_at = ? WHERE id = ?').run(Date.now() - 60_000, rows[0]!.id);
      const n = bridge.prune({ olderThan: Date.now() - 30_000 });
      assert.equal(n, 1);
      const left = db.prepare('SELECT id FROM approvals').all() as { id: string }[];
      assert.deepEqual(left.map((r) => r.id), [rows[1]!.id]);
    } finally {
      db.close();
    }
  });
});

test('opening a pre-migration database adds answered_by + expires_at', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-appr-'));
  const dbPath = join(dir, 'old.db');
  try {
    // The pre-attribution schema — no answered_by, no expires_at.
    const old = new DatabaseSync(dbPath);
    old.exec(`
      CREATE TABLE approvals (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, question TEXT NOT NULL, action TEXT,
        created_at INTEGER NOT NULL, answered_at INTEGER, approved INTEGER,
        answer_text TEXT, note TEXT
      );
      INSERT INTO approvals (id, kind, question, created_at)
        VALUES ('appr_old', 'approve', 'old pending request', ${Date.now()});
    `);
    old.close();

    const bridge = new SqliteApprovalBridge(dbPath, { pollMs: 10 });
    const check = new DatabaseSync(dbPath);
    try {
      const cols = new Set(
        (check.prepare('PRAGMA table_info(approvals)').all() as { name: string }[]).map((c) => c.name),
      );
      assert.ok(cols.has('answered_by') && cols.has('expires_at'), 'migration adds both columns');
      // The pre-existing pending row got its deadline backfilled, not vanished.
      assert.equal(bridge.pending()[0]?.id, 'appr_old');
    } finally {
      check.close();
      bridge.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
