import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** One row in the run index — what a `GET /runs` answer is built from. */
export interface RunSummary {
  readonly runId: string;
  readonly agentId: string;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  readonly goal: string;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly result?: unknown;
  readonly error?: string;
  /** Which replica owns the live run — cross-replica reads go elsewhere. */
  readonly host?: string;
  /** The submitting principal's tenant, if `naro serve` has one — see ADR 0013. */
  readonly tenantId?: string;
  /** This run's delegation-tree correlator (`NaroEvent.traceId`) — a root
   *  run's traceId equals its own runId; a delegated child's matches its
   *  parent's. Lets a client list every run in one delegation tree. */
  readonly traceId?: string;
}

/**
 * The durable run index. `naro serve` writes every run here, so the list
 * of runs — and each run's last-known status — survives a replica
 * restart and is shared between replicas pointing at the same store.
 */
export interface RunRegistry {
  upsert(run: RunSummary): Promise<void>;
  get(runId: string): Promise<RunSummary | undefined>;
  /** Newest first. `tenantId` restricts to runs stamped with that tenant —
   *  see ADR 0013; `traceId` restricts to one delegation tree. Omit either
   *  for unscoped visibility; both may be combined. */
  list(opts?: { limit?: number; tenantId?: string; traceId?: string }): Promise<readonly RunSummary[]>;
}

/** Default registry — process-local, lost on exit. Fine for dev/tests. */
export class InMemoryRunRegistry implements RunRegistry {
  private readonly runs = new Map<string, RunSummary>();

  upsert(run: RunSummary): Promise<void> {
    this.runs.set(run.runId, run);
    return Promise.resolve();
  }

  get(runId: string): Promise<RunSummary | undefined> {
    return Promise.resolve(this.runs.get(runId));
  }

  list(opts: { limit?: number; tenantId?: string; traceId?: string } = {}): Promise<readonly RunSummary[]> {
    const scoped = [...this.runs.values()]
      .filter((r) => opts.tenantId === undefined || r.tenantId === opts.tenantId)
      .filter((r) => opts.traceId === undefined || r.traceId === opts.traceId);
    const all = scoped.sort((a, b) => b.startedAt - a.startedAt);
    return Promise.resolve(all.slice(0, opts.limit ?? all.length));
  }
}

interface Row {
  run_id: string; agent_id: string; status: string; goal: string;
  started_at: number; updated_at: number; result: string | null;
  error: string | null; host: string | null; tenant_id: string | null;
  trace_id: string | null;
}

/** Durable run index on node:sqlite — survives restarts, shareable. */
export class SqliteRunRegistry implements RunRegistry {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        goal TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        result TEXT,
        error TEXT,
        host TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
    `);
    this.migrate();
  }

  /** Old databases predate `tenant_id` (ADR 0013) / `trace_id` — add what's missing. */
  private migrate(): void {
    const cols = new Set(
      (this.db.prepare('PRAGMA table_info(runs)').all() as { name: string }[]).map((c) => c.name),
    );
    if (!cols.has('tenant_id')) this.db.exec('ALTER TABLE runs ADD COLUMN tenant_id TEXT');
    if (!cols.has('trace_id')) {
      this.db.exec('ALTER TABLE runs ADD COLUMN trace_id TEXT');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_runs_trace ON runs(trace_id)');
    }
  }

  async upsert(run: RunSummary): Promise<void> {
    await this.db.prepare(`
      INSERT INTO runs (run_id, agent_id, status, goal, started_at, updated_at, result, error, host, tenant_id, trace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        status = excluded.status, updated_at = excluded.updated_at,
        result = excluded.result, error = excluded.error, host = excluded.host,
        tenant_id = excluded.tenant_id, trace_id = excluded.trace_id
    `).run(run.runId, run.agentId, run.status, run.goal, run.startedAt, run.updatedAt,
      run.result === undefined ? null : JSON.stringify(run.result),
      run.error ?? null, run.host ?? null, run.tenantId ?? null, run.traceId ?? null);
  }

  async get(runId: string): Promise<RunSummary | undefined> {
    const r = this.db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId) as Row | undefined;
    return r && toSummary(r);
  }

  async list(opts: { limit?: number; tenantId?: string; traceId?: string } = {}): Promise<readonly RunSummary[]> {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (opts.tenantId !== undefined) { clauses.push('tenant_id = ?'); params.push(opts.tenantId); }
    if (opts.traceId !== undefined) { clauses.push('trace_id = ?'); params.push(opts.traceId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')} ` : '';
    params.push(opts.limit ?? 10_000);
    const rows = this.db.prepare(`SELECT * FROM runs ${where}ORDER BY started_at DESC LIMIT ?`)
      .all(...params) as unknown as Row[];
    return rows.map(toSummary);
  }

  close(): void { this.db.close(); }
}

function toSummary(r: Row): RunSummary {
  return {
    runId: r.run_id, agentId: r.agent_id,
    status: r.status as RunSummary['status'],
    goal: r.goal, startedAt: r.started_at, updatedAt: r.updated_at,
    ...(r.result !== null && { result: JSON.parse(r.result) }),
    ...(r.error !== null && { error: r.error }),
    ...(r.host !== null && { host: r.host }),
    ...(r.tenant_id !== null && { tenantId: r.tenant_id }),
    ...(r.trace_id !== null && { traceId: r.trace_id }),
  };
}
