import type { Goal, NaroEvent } from '@naro/core';
import type { Checkpoint, CheckpointStore } from '@naro/runtime';
import type { LeaseStore } from '@naro/runtime';
import type { LimitStore } from '@naro/policy';
import type { EventExporter } from '@naro/observability';
import type { MemoryEntry, MemoryInput, MemoryStore, MemoryTier } from '@naro/memory';
import type { MemoryHit } from '@naro/core';
import type { AgentBus, AgentMessage } from '@naro/multiagent';
import { newId } from '@naro/core';
import type { PgQueryable } from './queryable.ts';

/**
 * Postgres implementations of every durable port — the multi-host tier.
 * Same contracts as the SQLite stores, different isolation story:
 * any process that can reach the database shares the truth.
 *
 *   const pool = await pgPool(process.env.DATABASE_URL!);
 *   const checkpoints = new PgCheckpointStore(pool);
 *   const bus = new PgAgentBus(pool);
 *
 * Tables are `naro_*`-namespaced and self-creating (idempotent DDL).
 * All timestamps are epoch-millis BIGINTs; payloads are JSONB.
 */

async function migrate(q: PgQueryable): Promise<void> {
  await q.query(`
    CREATE TABLE IF NOT EXISTS naro_checkpoints (
      seq BIGSERIAL,
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      state TEXT NOT NULL,
      at BIGINT NOT NULL,
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS naro_checkpoints_agent ON naro_checkpoints(agent_id, at DESC);

    CREATE TABLE IF NOT EXISTS naro_events (
      seq BIGSERIAL,
      id TEXT PRIMARY KEY,
      event_seq BIGINT NOT NULL,
      run_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      goal_id TEXT NOT NULL,
      type TEXT NOT NULL,
      at BIGINT NOT NULL,
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS naro_events_agent ON naro_events(agent_id, event_seq);
    CREATE INDEX IF NOT EXISTS naro_events_run ON naro_events(run_id);

    CREATE TABLE IF NOT EXISTS naro_memory (
      key TEXT PRIMARY KEY,
      id TEXT NOT NULL,
      tier TEXT NOT NULL,
      tags JSONB NOT NULL,
      content JSONB NOT NULL,
      agent_id TEXT,
      source TEXT,
      at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS naro_leases (
      key TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    -- Atomic quota counters: one row per (rule, window-bucket).
    -- A single UPSERT...RETURNING is the increment AND the read.
    CREATE TABLE IF NOT EXISTS naro_limits (
      key TEXT NOT NULL,
      bucket BIGINT NOT NULL,
      n INTEGER NOT NULL,
      PRIMARY KEY (key, bucket)
    );

    CREATE TABLE IF NOT EXISTS naro_bus_tasks (
      id TEXT PRIMARY KEY,
      to_agent TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      goal JSONB NOT NULL,
      status TEXT NOT NULL,
      result JSONB,
      error TEXT,
      created_at BIGINT NOT NULL,
      claimed_at BIGINT,
      completed_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS naro_bus_pending ON naro_bus_tasks(status, to_agent);
  `);
}

// --- checkpoints -----------------------------------------------------------

export class PgCheckpointStore implements CheckpointStore {
  private readonly q: PgQueryable;
  private constructor(q: PgQueryable) { this.q = q; }
  static async create(q: PgQueryable): Promise<PgCheckpointStore> {
    await migrate(q);
    return new PgCheckpointStore(q);
  }

  async save(c: Checkpoint): Promise<void> {
    await this.q.query(
      'INSERT INTO naro_checkpoints (id, agent_id, state, at, data) VALUES ($1,$2,$3,$4,$5)',
      [c.id, c.agentId, c.state, c.at, JSON.stringify(c.data)],
    );
  }

  async latest(agentId: string): Promise<Checkpoint | undefined> {
    const { rows } = await this.q.query(
      'SELECT * FROM naro_checkpoints WHERE agent_id=$1 ORDER BY at DESC, seq DESC LIMIT 1', [agentId]);
    const r = rows[0];
    return r && {
      id: r['id'] as string, agentId: r['agent_id'] as string, state: r['state'] as Checkpoint['state'],
      at: Number(r['at']), data: r['data'] as Checkpoint['data'],
    };
  }
}

// --- events ----------------------------------------------------------------

export class PgEventStore implements EventExporter {
  private readonly q: PgQueryable;
  private constructor(q: PgQueryable) { this.q = q; }
  static async create(q: PgQueryable): Promise<PgEventStore> {
    await migrate(q);
    return new PgEventStore(q);
  }

  /** Multi-row INSERT — one statement, so the batch is atomic without BEGIN. */
  async export(events: readonly NaroEvent[]): Promise<void> {
    if (events.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    events.forEach((e, i) => {
      const b = i * 8;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
      params.push(e.id, e.seq, e.runId, e.agentId, e.goalId, e.type, e.at, JSON.stringify(e.data));
    });
    await this.q.query(
      `INSERT INTO naro_events (id, event_seq, run_id, agent_id, goal_id, type, at, data)
       VALUES ${values.join(',')} ON CONFLICT (id) DO NOTHING`,
      params,
    );
  }

  async history(filter: { agentId?: string; runId?: string } = {}): Promise<readonly NaroEvent[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.agentId) { params.push(filter.agentId); where.push(`agent_id=$${params.length}`); }
    if (filter.runId) { params.push(filter.runId); where.push(`run_id=$${params.length}`); }
    const { rows } = await this.q.query(
      `SELECT * FROM naro_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY event_seq, seq`,
      params,
    );
    return rows.map((r) => ({
      id: r['id'] as string, seq: Number(r['event_seq']), runId: r['run_id'] as string,
      agentId: r['agent_id'] as string, goalId: r['goal_id'] as string,
      type: r['type'] as NaroEvent['type'], at: Number(r['at']), data: r['data'],
    }) as NaroEvent);
  }
}

// --- memory -----------------------------------------------------------------

export class PgMemoryStore implements MemoryStore {
  private readonly q: PgQueryable;
  private constructor(q: PgQueryable) { this.q = q; }
  static async create(q: PgQueryable): Promise<PgMemoryStore> {
    await migrate(q);
    return new PgMemoryStore(q);
  }

  async write(input: MemoryInput): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      id: newId('mem'), key: input.key, content: input.content,
      tier: input.tier ?? 'semantic', tags: input.tags ?? [],
      at: Date.now(),
      ...(input.agentId !== undefined && { agentId: input.agentId }),
      ...(input.source !== undefined && { source: input.source }),
    };
    await this.q.query(
      `INSERT INTO naro_memory (key, id, tier, tags, content, agent_id, source, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (key) DO UPDATE SET id=$2, tier=$3, tags=$4, content=$5, agent_id=$6, source=$7, at=$8`,
      [entry.key, entry.id, entry.tier, JSON.stringify(entry.tags), JSON.stringify(entry.content),
       entry.agentId ?? null, entry.source ?? null, entry.at],
    );
    return entry;
  }

  async read(key: string): Promise<MemoryEntry | undefined> {
    const { rows } = await this.q.query('SELECT * FROM naro_memory WHERE key=$1', [key]);
    return rows[0] ? toEntry(rows[0]!) : undefined;
  }

  search(query: string, limit = 10): Promise<readonly MemoryHit[]> {
    return this.searchWhere('', query, limit);
  }

  searchTier(tier: MemoryTier, query: string, limit = 10): Promise<readonly MemoryHit[]> {
    return this.searchWhere('AND tier=$2', query, limit, [tier]);
  }

  private async searchWhere(extra: string, query: string, limit: number, params: unknown[] = []): Promise<readonly MemoryHit[]> {
    const { rows } = await this.q.query(
      `SELECT * FROM naro_memory
       WHERE (key ILIKE $1 OR content::text ILIKE $1 OR tags::text ILIKE $1) ${extra}
       ORDER BY at DESC LIMIT $${params.length + 2}`,
      [`%${query}%`, ...params, limit],
    );
    return rows.map((r): MemoryHit => {
      const e = toEntry(r);
      return { id: e.id, key: e.key, content: e.content, score: 1 };
    });
  }

  async forget(key: string): Promise<boolean> {
    const { rows } = await this.q.query('DELETE FROM naro_memory WHERE key=$1 RETURNING key', [key]);
    return rows.length === 1;
  }
}

function toEntry(r: Record<string, unknown>): MemoryEntry {
  return {
    id: r['id'] as string, key: r['key'] as string, tier: r['tier'] as MemoryTier,
    tags: r['tags'] as string[], content: r['content'], at: Number(r['at']),
    ...(r['agent_id'] != null && { agentId: r['agent_id'] as string }),
    ...(r['source'] != null && { source: r['source'] as string }),
  };
}

// --- leases ------------------------------------------------------------------

export class PgLeaseStore implements LeaseStore {
  private readonly q: PgQueryable;
  private constructor(q: PgQueryable) { this.q = q; }
  static async create(q: PgQueryable): Promise<PgLeaseStore> {
    await migrate(q);
    return new PgLeaseStore(q);
  }

  /** One statement, atomic: take the lease iff free-or-mine-or-expired. */
  async acquire(key: string, holder: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const { rows } = await this.q.query(
      `INSERT INTO naro_leases (key, holder, expires_at) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO UPDATE SET holder=$2, expires_at=$3
       WHERE naro_leases.expires_at <= $4 OR naro_leases.holder = $2
       RETURNING holder`,
      [key, holder, now + ttlMs, now],
    );
    return rows.length === 1;
  }

  async heartbeat(key: string, holder: string, ttlMs: number): Promise<boolean> {
    const { rows } = await this.q.query(
      'UPDATE naro_leases SET expires_at=$1 WHERE key=$2 AND holder=$3 AND expires_at > $4 RETURNING key',
      [Date.now() + ttlMs, key, holder, Date.now()],
    );
    return rows.length === 1;
  }

  async release(key: string, holder: string): Promise<void> {
    await this.q.query('DELETE FROM naro_leases WHERE key=$1 AND holder=$2', [key, holder]);
  }
}

// --- quotas ------------------------------------------------------------------

export class PgLimitStore implements LimitStore {
  private readonly q: PgQueryable;
  private constructor(q: PgQueryable) { this.q = q; }
  static async create(q: PgQueryable): Promise<PgLimitStore> {
    await migrate(q);
    return new PgLimitStore(q);
  }

  /**
   * Atomic increment: windowed quotas bucket time (floor(now/windowMs)),
   * so one UPSERT row per bucket both counts and enforces — two hosts
   * cannot both slip under the cap.
   */
  async record(key: string, windowMs: number | undefined, now: number): Promise<number> {
    const bucket = windowMs === undefined ? 0 : Math.floor(now / windowMs);
    const { rows } = await this.q.query(
      `INSERT INTO naro_limits (key, bucket, n) VALUES ($1,$2,1)
       ON CONFLICT (key, bucket) DO UPDATE SET n = naro_limits.n + 1
       RETURNING n`,
      [key, bucket],
    );
    return Number(rows[0]!['n']);
  }
}

// --- durable bus --------------------------------------------------------------

type TaskRequest = Extract<AgentMessage, { kind: 'task-request' }>;

interface TaskRow {
  id: string; to_agent: string; from_agent: string; goal: unknown;
  status: 'pending' | 'claimed' | 'completed' | 'failed' | 'timed-out';
  result: unknown; error: string | null;
  created_at: number; claimed_at: number | null; completed_at: number | null;
}

/**
 * The multi-host AgentBus: `FOR UPDATE SKIP LOCKED` is the queue primitive
 * Postgres was built for — N workers poll, each pending row goes to exactly
 * one claimer, crashed workers' claims are reclaimed by age.
 */
export class PgAgentBus implements AgentBus {
  private readonly q: PgQueryable;
  private readonly opts: { pollMs: number; reclaimAfterMs: number };
  private readonly pollers: ReturnType<typeof setInterval>[] = [];
  private closed = false;

  private constructor(q: PgQueryable, opts: { pollMs?: number; reclaimAfterMs?: number } = {}) {
    this.q = q;
    this.opts = { pollMs: opts.pollMs ?? 100, reclaimAfterMs: opts.reclaimAfterMs ?? 30_000 };
  }
  static async create(q: PgQueryable, opts: { pollMs?: number; reclaimAfterMs?: number } = {}): Promise<PgAgentBus> {
    await migrate(q);
    return new PgAgentBus(q, opts);
  }

  serve(agentId: string, handler: (msg: TaskRequest) => Promise<unknown>): void {
    const tick = async (): Promise<void> => {
      if (this.closed) return;
      // Reclaim stale claims first — a dead worker's tasks come back.
      await this.q.query(
        `UPDATE naro_bus_tasks SET status='pending', claimed_at=NULL
         WHERE status='claimed' AND claimed_at < $1`,
        [Date.now() - this.opts.reclaimAfterMs],
      );
      // SKIP LOCKED: each row to exactly one worker, no two-phase dance.
      const { rows } = await this.q.query<TaskRow>(
        `UPDATE naro_bus_tasks SET status='claimed', claimed_at=$2
         WHERE id = (
           SELECT id FROM naro_bus_tasks
           WHERE status='pending' AND to_agent=$1
           ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
         ) RETURNING *`,
        [agentId, Date.now()],
      );
      const row = rows[0];
      if (!row) return;
      try {
        const result = await handler({
          kind: 'task-request', id: row.id, from: row.from_agent,
          goal: row.goal as Goal, at: Number(row.created_at),
        });
        await this.q.query(
          `UPDATE naro_bus_tasks SET status='completed', result=$1, completed_at=$2 WHERE id=$3`,
          [JSON.stringify(result ?? null), Date.now(), row.id],
        );
      } catch (e) {
        await this.q.query(
          `UPDATE naro_bus_tasks SET status='failed', error=$1, completed_at=$2 WHERE id=$3`,
          [e instanceof Error ? e.message : String(e), Date.now(), row.id],
        );
      }
    };
    this.pollers.push(setInterval(() => void tick().catch(() => {}), this.opts.pollMs));
  }

  async request(to: string, goal: Goal, from: string, timeoutMs = 30_000): Promise<unknown> {
    const id = newId('task');
    await this.q.query(
      `INSERT INTO naro_bus_tasks (id, to_agent, from_agent, goal, status, created_at) VALUES ($1,$2,$3,$4,'pending',$5)`,
      [id, to, from, JSON.stringify(goal), Date.now()],
    );
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { rows } = await this.q.query<TaskRow>(
        'SELECT status, result, error FROM naro_bus_tasks WHERE id=$1', [id]);
      const row = rows[0];
      if (row?.status === 'completed') return row.result;
      if (row?.status === 'failed') throw new Error(`agent '${to}' task failed: ${row.error}`);
      if (Date.now() >= deadline) {
        await this.q.query(
          `UPDATE naro_bus_tasks SET status='timed-out' WHERE id=$1 AND status IN ('pending','claimed')`, [id]);
        throw new Error(`agent '${to}' timed out — task ${id} marked timed-out, may still complete`);
      }
      await new Promise((r) => setTimeout(r, this.opts.pollMs));
    }
  }

  close(): void {
    this.closed = true;
    for (const p of this.pollers) clearInterval(p);
  }
}
