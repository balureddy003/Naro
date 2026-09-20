import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NaroEvent } from '@naro/core';
import type { EventExporter } from './exporter.ts';

interface Row {
  id: string; seq: number; run_id: string; agent_id: string;
  goal_id: string; type: string; at: number; data: string;
}

/**
 * A durable, queryable event journal on node:sqlite.
 *
 * Doubles as an EventExporter (pipe a bus into it) and a replay source:
 * `history()` reads events back in seq order for metrics, debugging, or
 * feeding a new run's forensics. Same guarantee as JsonlExporter plus
 * indexed queries — file-per-agent JSONL stays the lightweight option.
 */
export class SqliteEventStore implements EventExporter {
  private readonly db: DatabaseSync;
  private writeError: unknown;
  private pending: Promise<void> = Promise.resolve();

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        run_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        type TEXT NOT NULL,
        at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, seq);
      CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, seq);
    `);
  }

  export(events: readonly NaroEvent[]): Promise<void> {
    this.pending = this.pending.then(() => {
      if (events.length === 0 || this.writeError) return;
      try {
        const insert = this.db.prepare(
          'INSERT OR IGNORE INTO events (id, seq, run_id, agent_id, goal_id, type, at, data) VALUES (?,?,?,?,?,?,?,?)');
        this.db.exec('BEGIN');
        try {
          for (const e of events) {
            insert.run(e.id, e.seq, e.runId, e.agentId, e.goalId, e.type, e.at, JSON.stringify(e.data));
          }
          this.db.exec('COMMIT');
        } catch (err) { this.db.exec('ROLLBACK'); throw err; }
      } catch (err) { this.writeError = err; }
    });
    return this.pending;
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.writeError) throw this.writeError;
  }

  /** Ordered journal — filter by agent and/or run. */
  history(filter: { agentId?: string; runId?: string } = {}): readonly NaroEvent[] {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.agentId) { where.push('agent_id = ?'); args.push(filter.agentId); }
    if (filter.runId) { where.push('run_id = ?'); args.push(filter.runId); }
    const rows = this.db.prepare(
      `SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq, rowid`,
    ).all(...args) as unknown as Row[];
    return rows.map((r) => ({
      id: r.id, seq: r.seq, runId: r.run_id, agentId: r.agent_id, goalId: r.goal_id,
      type: r.type, at: r.at, data: JSON.parse(r.data),
    }) as NaroEvent);
  }

  /** Distinct runs seen — for "list runs" tooling. */
  runs(): readonly { runId: string; agentId: string; events: number; firstAt: number; lastAt: number }[] {
    const rows = this.db.prepare(
      'SELECT run_id, agent_id, COUNT(*) n, MIN(at) first, MAX(at) last FROM events GROUP BY run_id',
    ).all() as unknown as { run_id: string; agent_id: string; n: number; first: number; last: number }[];
    return rows.map((r) => ({ runId: r.run_id, agentId: r.agent_id, events: r.n, firstAt: r.first, lastAt: r.last }));
  }

  close(): void { this.db.close(); }
}
