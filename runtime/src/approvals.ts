import { DatabaseSync } from 'node:sqlite';
import { newId, type Action } from '@naro/core';
import type { HumanBridge } from './human.ts';

export interface ApprovalRequest {
  readonly id: string;
  readonly kind: 'approve' | 'ask';
  readonly question: string;
  readonly action?: Action;
  readonly createdAt: number;
  /** createdAt + the bridge's timeoutMs — past this, the request is dead. */
  readonly expiresAt: number;
  /** Identity of whoever answered (the serve principal's id), if known. */
  readonly answeredBy?: string;
  /** Filled by the responder — undefined while pending. */
  readonly answer?: { approved?: boolean; text?: string; note?: string; at: number };
}

/**
 * A HumanBridge backed by SQLite: requests are rows, responses are
 * updates written by `naro approve`/`naro answer` (or any process sharing
 * the file). The agent parks in WAITING_FOR_HUMAN while pending — and a
 * crashed runner's pending request still exists for the next runner.
 *
 * Timeouts fail closed: an unanswered approval resolves `denied`, an
 * unanswered question resolves with an empty string. `expiresAt` makes the
 * deadline a row property, so `pending()` and `respond()` agree across
 * processes — an expired row is neither pending nor answerable.
 *
 * `answered_by` carries the responder's control-plane identity through to
 * `approve()`'s `by` — and from there onto `human.approval.received`, so
 * the journal records *who* approved, not just *that* someone did.
 */
export class SqliteApprovalBridge implements HumanBridge {
  private readonly db: DatabaseSync;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(path: string, opts: { pollMs?: number; timeoutMs?: number } = {}) {
    this.db = new DatabaseSync(path);
    this.pollMs = opts.pollMs ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 30 * 60_000;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        question TEXT NOT NULL,
        action TEXT,
        created_at INTEGER NOT NULL,
        answered_at INTEGER,
        approved INTEGER,
        answer_text TEXT,
        note TEXT
      );
    `);
    this.migrate();
  }

  approve(action: Action, question?: string): Promise<{ approved: boolean; note?: string; by?: string }> {
    const id = this.insert('approve', question ?? `approve ${action.capability} → ${action.target}`, action);
    return this.wait(id).then((a) => ({
      approved: a?.answer?.approved === true,
      ...(a?.answer?.note !== undefined && { note: a.answer.note }),
      ...(a?.answeredBy !== undefined && { by: a.answeredBy }),
    }));
  }

  ask(question: string): Promise<string> {
    const id = this.insert('ask', question);
    return this.wait(id).then((a) => a?.answer?.text ?? '');
  }

  /**
   * Operator side — respond to a pending request. `by` is the responder's
   * identity (a serve principal id). Refuses expired rows: a deadline the
   * runner already enforced can't be answered after the fact.
   */
  respond(id: string, answer: { approved?: boolean; text?: string; note?: string }, by?: string): boolean {
    const r = this.db.prepare(
      'UPDATE approvals SET answered_at = ?, approved = ?, answer_text = ?, note = ?, answered_by = ? WHERE id = ? AND answered_at IS NULL AND expires_at > ?',
    ).run(Date.now(), answer.approved === undefined ? null : (answer.approved ? 1 : 0),
      answer.text ?? null, answer.note ?? null, by ?? null, id, Date.now());
    return r.changes === 1;
  }

  /** Pending requests — what an operator's queue looks like. */
  pending(): ApprovalRequest[] {
    return (this.db.prepare('SELECT * FROM approvals WHERE answered_at IS NULL AND expires_at > ? ORDER BY created_at')
      .all(Date.now()) as unknown as Row[])
      .map(toRequest);
  }

  /**
   * Delete answered requests resolved before the cutoff; returns the count.
   * Approvals are operational records — prune freely. The journal is the
   * evidence: it is exported and sealed, never deleted.
   */
  prune(opts: { olderThan: number }): number {
    const r = this.db.prepare(
      'DELETE FROM approvals WHERE answered_at IS NOT NULL AND answered_at < ?',
    ).run(opts.olderThan);
    return Number(r.changes);
  }

  close(): void {
    this.db.close();
  }

  /** Old deployments predate answered_by/expires_at — add what's missing. */
  private migrate(): void {
    const cols = new Set(
      (this.db.prepare('PRAGMA table_info(approvals)').all() as { name: string }[]).map((c) => c.name),
    );
    if (!cols.has('answered_by')) this.db.exec('ALTER TABLE approvals ADD COLUMN answered_by TEXT');
    if (!cols.has('expires_at')) {
      this.db.exec('ALTER TABLE approvals ADD COLUMN expires_at INTEGER');
      // Backfill so pre-migration pending rows keep their original deadline
      // instead of expiring instantly (NULL would fail `expires_at > now`).
      this.db.prepare('UPDATE approvals SET expires_at = created_at + ? WHERE expires_at IS NULL')
        .run(this.timeoutMs);
    }
  }

  private insert(kind: 'approve' | 'ask', question: string, action?: Action): string {
    const id = newId('appr');
    const now = Date.now();
    this.db.prepare('INSERT INTO approvals (id, kind, question, action, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, kind, question, action ? JSON.stringify(action) : null, now, now + this.timeoutMs);
    return id;
  }

  private wait(id: string): Promise<ApprovalRequest | undefined> {
    const deadline = Date.now() + this.timeoutMs;
    return new Promise((resolve) => {
      const tick = (): void => {
        const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Row | undefined;
        if (row?.answered_at !== null && row?.answered_at !== undefined) {
          resolve(toRequest(row));
          return;
        }
        if (Date.now() >= deadline) { resolve(undefined); return; }
        setTimeout(tick, this.pollMs);
      };
      tick();
    });
  }
}

interface Row {
  id: string; kind: 'approve' | 'ask'; question: string; action: string | null;
  created_at: number; answered_at: number | null; approved: number | null;
  answer_text: string | null; note: string | null;
  expires_at: number | null; answered_by: string | null;
}

function toRequest(r: Row): ApprovalRequest {
  const answered = r.answered_at !== null;
  return {
    id: r.id, kind: r.kind, question: r.question, createdAt: r.created_at,
    expiresAt: r.expires_at ?? r.created_at,
    ...(r.action !== null && { action: JSON.parse(r.action) as Action }),
    ...(r.answered_by !== null && { answeredBy: r.answered_by }),
    ...(answered && {
      answer: {
        ...(r.approved !== null && { approved: r.approved === 1 }),
        ...(r.answer_text !== null && { text: r.answer_text }),
        ...(r.note !== null && { note: r.note }),
        at: r.answered_at!,
      },
    }),
  };
}
