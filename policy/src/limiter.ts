import { DatabaseSync } from 'node:sqlite';

/**
 * Where `limit` rule counters live.
 *
 * The in-memory default is correct for one process. A SQLite-backed store
 * shares quotas across processes on one host (BEGIN IMMEDIATE serializes
 * increments); Redis/Postgres implementations plug into the same port for
 * multi-host fleets.
 */
export interface LimitStore {
  /**
   * Record a call for `key` and return how many calls are inside the
   * current window (including this one). `windowMs` undefined = forever.
   */
  record(key: string, windowMs: number | undefined, now: number): Promise<number> | number;
}

/** Process-local counters — the default, and the right scope for tests. */
export class InMemoryLimitStore implements LimitStore {
  private readonly calls = new Map<string, number[]>();

  record(key: string, windowMs: number | undefined, now: number): number {
    const windowStart = windowMs !== undefined ? now - windowMs : 0;
    const recent = (this.calls.get(key) ?? []).filter((t) => t >= windowStart);
    recent.push(now);
    this.calls.set(key, recent);
    return recent.length;
  }
}

/**
 * Durable, multi-process quota counters on node:sqlite.
 * One table of timestamps; every record() is a transaction so two
 * processes can't both slip under the cap.
 */
export class SqliteLimitStore implements LimitStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS limit_calls (
        key TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_limit_calls ON limit_calls(key, at);
    `);
  }

  record(key: string, windowMs: number | undefined, now: number): number {
    const windowStart = windowMs !== undefined ? now - windowMs : 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO limit_calls (key, at) VALUES (?, ?)').run(key, now);
      const row = this.db.prepare(
        'SELECT COUNT(*) AS n FROM limit_calls WHERE key = ? AND at >= ?',
      ).get(key, windowStart) as { n: number };
      // Bound the table: drop calls older than any window could reach.
      if (windowMs !== undefined) {
        this.db.prepare('DELETE FROM limit_calls WHERE key = ? AND at < ?').run(key, windowStart);
      }
      this.db.exec('COMMIT');
      return row.n;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.db.close();
  }
}
