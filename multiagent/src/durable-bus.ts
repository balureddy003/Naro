import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { newId, type Goal } from '@naro/core';
import type { AgentBus, AgentMessage } from './bus.ts';

type TaskRequest = Extract<AgentMessage, { kind: 'task-request' }>;

interface TaskRow {
  id: string; to_agent: string; from_agent: string; goal: string;
  status: 'pending' | 'claimed' | 'completed' | 'failed' | 'timed-out';
  result: string | null; error: string | null;
  created_at: number; claimed_at: number | null; completed_at: number | null;
}

export interface DurableBusOptions {
  /** Poll interval for both servers and requesters. Default 25ms. */
  readonly pollMs?: number;
  /**
   * A task 'claimed' longer than this is reclaimed by another poll —
   * at-least-once delivery across worker crashes. Default 30s.
   */
  readonly reclaimAfterMs?: number;
}

/**
 * A durable AgentBus: delegation requests are rows in SQLite, not
 * in-memory calls. Properties that matter for production:
 *
 *  - Persistence: a pending task survives a requester/worker crash.
 *  - At-least-once: claiming is atomic; a worker that dies mid-task has
 *    its task reclaimed after `reclaimAfterMs`.
 *  - Auditability: the table IS the delegation log — who asked whom,
 *    what, when, and how it ended.
 *
 * Cross-process: any number of processes sharing one db file get
 * delivery. For multi-host, swap in a Postgres implementation behind
 * this same AgentBus contract.
 */
export class DurableAgentBus implements AgentBus {
  private readonly db: DatabaseSync;
  private readonly opts: Required<DurableBusOptions>;
  private readonly pollers: ReturnType<typeof setInterval>[] = [];
  private closed = false;

  constructor(path: string, opts: DurableBusOptions = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.opts = { pollMs: 25, reclaimAfterMs: 30_000, ...opts };
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bus_tasks (
        id TEXT PRIMARY KEY,
        to_agent TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        claimed_at INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_bus_pending ON bus_tasks(status, to_agent);
    `);
  }

  /** Register a worker: polls for pending tasks addressed to agentId. */
  serve(agentId: string, handler: (msg: TaskRequest) => Promise<unknown>): void {
    const tick = async () => {
      if (this.closed) return;
      // Reclaim stale claims — a dead worker's tasks come back.
      this.db.prepare(
        `UPDATE bus_tasks SET status='pending', claimed_at=NULL
         WHERE status='claimed' AND to_agent=? AND claimed_at < ?`,
      ).run(agentId, Date.now() - this.opts.reclaimAfterMs);

      const row = this.db.prepare(
        `SELECT * FROM bus_tasks WHERE status='pending' AND to_agent=? ORDER BY created_at LIMIT 1`,
      ).get(agentId) as TaskRow | undefined;
      if (!row) return;
      // Atomic claim — only succeeds if still pending (single-writer SQLite
      // makes the UPDATE itself the lock; a racing claimer gets changes=0).
      const claimed = this.db.prepare(
        `UPDATE bus_tasks SET status='claimed', claimed_at=? WHERE id=? AND status='pending'`,
      ).run(Date.now(), row.id);
      if (claimed.changes === 0) return;

      const msg: TaskRequest = {
        kind: 'task-request', id: row.id, from: row.from_agent,
        goal: JSON.parse(row.goal) as Goal, at: row.created_at,
      };
      try {
        const result = await handler(msg);
        this.db.prepare(
          `UPDATE bus_tasks SET status='completed', result=?, completed_at=? WHERE id=?`,
        ).run(JSON.stringify(result ?? null), Date.now(), row.id);
      } catch (e) {
        this.db.prepare(
          `UPDATE bus_tasks SET status='failed', error=?, completed_at=? WHERE id=?`,
        ).run(e instanceof Error ? e.message : String(e), Date.now(), row.id);
      }
    };
    this.pollers.push(setInterval(() => void tick(), this.opts.pollMs));
  }

  /** Enqueue a task and await its terminal state. */
  async request(to: string, goal: Goal, from: string, timeoutMs = 30_000): Promise<unknown> {
    const id = newId('task');
    this.db.prepare(
      `INSERT INTO bus_tasks (id, to_agent, from_agent, goal, status, created_at) VALUES (?,?,?,?,'pending',?)`,
    ).run(id, to, from, JSON.stringify(goal), Date.now());

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = this.db.prepare('SELECT status, result, error FROM bus_tasks WHERE id=?').get(id) as
        Pick<TaskRow, 'status' | 'result' | 'error'> | undefined;
      if (row?.status === 'completed') return row.result === null ? undefined : JSON.parse(row.result);
      if (row?.status === 'failed') throw new Error(`agent '${to}' task failed: ${row.error}`);
      if (Date.now() >= deadline) {
        this.db.prepare(`UPDATE bus_tasks SET status='timed-out' WHERE id=? AND status IN ('pending','claimed')`).run(id);
        throw new Error(`agent '${to}' timed out — task ${id} marked timed-out, may still complete`);
      }
      await new Promise((r) => setTimeout(r, this.opts.pollMs));
    }
  }

  /** Inspect the queue — for ops dashboards and stuck-task forensics. */
  tasks(status?: TaskRow['status']): readonly TaskRow[] {
    return (status
      ? this.db.prepare('SELECT * FROM bus_tasks WHERE status=? ORDER BY created_at').all(status)
      : this.db.prepare('SELECT * FROM bus_tasks ORDER BY created_at').all()) as unknown as TaskRow[];
  }

  close(): void {
    this.closed = true;
    for (const p of this.pollers) clearInterval(p);
    this.db.close();
  }
}
