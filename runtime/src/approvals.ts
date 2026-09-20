import { DatabaseSync } from 'node:sqlite';
import { newId, type Action } from '@naro/core';
import type { HumanBridge } from './human.ts';

export interface ApprovalRequest {
  readonly id: string;
  readonly kind: 'approve' | 'ask';
  readonly question: string;
  readonly action?: Action;
  readonly createdAt: number;
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
 * unanswered question resolves with an empty string.
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
  }

  approve(action: Action, question?: string): Promise<{ approved: boolean; note?: string }> {
    const id = this.insert('approve', question ?? `approve ${action.capability} → ${action.target}`, action);
    return this.wait(id).then((a) => ({
      approved: a?.answer?.approved === true,
      ...(a?.answer?.note !== undefined && { note: a.answer.note }),
    }));
  }

  ask(question: string): Promise<string> {
    const id = this.insert('ask', question);
    return this.wait(id).then((a) => a?.answer?.text ?? '');
  }

  /** Operator side — respond to a pending request. */
  respond(id: string, answer: { approved?: boolean; text?: string; note?: string }): boolean {
    const r = this.db.prepare(
      'UPDATE approvals SET answered_at = ?, approved = ?, answer_text = ?, note = ? WHERE id = ? AND answered_at IS NULL',
    ).run(Date.now(), answer.approved === undefined ? null : (answer.approved ? 1 : 0),
      answer.text ?? null, answer.note ?? null, id);
    return r.changes === 1;
  }

  /** Pending requests — what an operator's queue looks like. */
  pending(): ApprovalRequest[] {
    return (this.db.prepare('SELECT * FROM approvals WHERE answered_at IS NULL ORDER BY created_at').all() as unknown as Row[])
      .map(toRequest);
  }

  close(): void {
    this.db.close();
  }

  private insert(kind: 'approve' | 'ask', question: string, action?: Action): string {
    const id = newId('appr');
    this.db.prepare('INSERT INTO approvals (id, kind, question, action, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, kind, question, action ? JSON.stringify(action) : null, Date.now());
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
}

function toRequest(r: Row): ApprovalRequest {
  const answered = r.answered_at !== null;
  return {
    id: r.id, kind: r.kind, question: r.question, createdAt: r.created_at,
    ...(r.action !== null && { action: JSON.parse(r.action) as Action }),
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
