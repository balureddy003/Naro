import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NaroEvent } from '@naro/core';
import type { EventExporter } from './exporter.ts';
import { buildPruneMarker, planPrune, type PrunableEventStore, type PruneOptions, type PruneResult } from './prune.ts';

interface Row {
  id: string; seq: number; run_id: string; agent_id: string;
  goal_id: string; type: string; at: number; data: string;
  prev: string | null; hash: string | null;
}

/**
 * A durable, queryable event journal on node:sqlite.
 *
 * Doubles as an EventExporter (pipe a bus into it) and a replay source:
 * `history()` reads events back in seq order for metrics, debugging, or
 * feeding a new run's forensics. Same guarantee as JsonlExporter plus
 * indexed queries — file-per-agent JSONL stays the lightweight option.
 */
export class SqliteEventStore implements EventExporter, PrunableEventStore {
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
        data TEXT NOT NULL,
        prev TEXT,
        hash TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, seq);
      CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, seq);
    `);
    // Databases created before chaining existed lack prev/hash — add them.
    const cols = new Set(
      (this.db.prepare('PRAGMA table_info(events)').all() as unknown as { name: string }[]).map((c) => c.name),
    );
    if (!cols.has('prev')) this.db.exec('ALTER TABLE events ADD COLUMN prev TEXT');
    if (!cols.has('hash')) this.db.exec('ALTER TABLE events ADD COLUMN hash TEXT');
  }

  export(events: readonly NaroEvent[]): Promise<void> {
    this.pending = this.pending.then(() => {
      if (events.length === 0 || this.writeError) return;
      try {
        const insert = this.db.prepare(
          'INSERT OR IGNORE INTO events (id, seq, run_id, agent_id, goal_id, type, at, data, prev, hash) VALUES (?,?,?,?,?,?,?,?,?,?)');
        this.db.exec('BEGIN');
        try {
          for (const e of events) {
            insert.run(e.id, e.seq, e.runId, e.agentId, e.goalId, e.type, e.at, JSON.stringify(e.data),
              e.prev ?? null, e.hash ?? null);
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
      ...(r.prev !== null && { prev: r.prev }),
      ...(r.hash !== null && { hash: r.hash }),
    }) as NaroEvent);
  }

  /**
   * Attested retention prune (ADR 0018): writes the disclosure marker as
   * the journal's new first row, then deletes the covered rows — one
   * transaction, so a crash can never leave rows deleted without their
   * marker. Refuses non-terminal runs and cutoffs that erase the terminal
   * event.
   */
  async prune(runId: string, throughSeq: number, opts: PruneOptions = {}): Promise<PruneResult> {
    const { anchorHash, run } = planPrune(this.history({ runId }), throughSeq);
    const marker = buildPruneMarker(run, throughSeq, anchorHash, opts);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(
        'INSERT INTO events (id, seq, run_id, agent_id, goal_id, type, at, data, prev, hash) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ).run(marker.id, marker.seq, marker.runId, marker.agentId, marker.goalId, marker.type,
        marker.at, JSON.stringify(marker.data), marker.prev ?? null, marker.hash ?? null);
      // The marker itself sits at seq = throughSeq — exclude it explicitly.
      const r = this.db.prepare('DELETE FROM events WHERE run_id = ? AND seq <= ? AND id != ?')
        .run(runId, throughSeq, marker.id);
      this.db.exec('COMMIT');
      return { pruned: Number(r.changes), anchorHash };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
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
