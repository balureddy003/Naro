import { DatabaseSync } from 'node:sqlite';

/**
 * Runner leases: only one live runner may execute a given agent at a time.
 *
 * The port: acquire with a TTL, heartbeat to keep it, release on exit.
 * A crashed holder's lease expires on its own — the TTL IS the fencing.
 * SQLite gives multi-process mutual exclusion on one host; a Redis
 * (SET NX PX) or etcd implementation plugs into the same contract for
 * multi-host.
 */
export interface LeaseStore {
  /** True if `holder` now holds `key`. False if another live holder does. */
  acquire(key: string, holder: string, ttlMs: number): Promise<boolean> | boolean;
  /** Extend the lease; false if it was lost (expired or stolen). */
  heartbeat(key: string, holder: string, ttlMs: number): Promise<boolean> | boolean;
  /** Give it back. Safe to call for a lease you no longer hold. */
  release(key: string, holder: string): Promise<void> | void;
}

export class InMemoryLeaseStore implements LeaseStore {
  private readonly held = new Map<string, { holder: string; expiresAt: number }>();

  acquire(key: string, holder: string, ttlMs: number): boolean {
    const cur = this.held.get(key);
    if (cur && cur.expiresAt > Date.now() && cur.holder !== holder) return false;
    this.held.set(key, { holder, expiresAt: Date.now() + ttlMs });
    return true;
  }

  heartbeat(key: string, holder: string, ttlMs: number): boolean {
    const cur = this.held.get(key);
    if (!cur || cur.holder !== holder || cur.expiresAt <= Date.now()) return false;
    cur.expiresAt = Date.now() + ttlMs;
    return true;
  }

  release(key: string, holder: string): void {
    if (this.held.get(key)?.holder === holder) this.held.delete(key);
  }
}

/** Multi-process leases on node:sqlite — one row per key, atomic compare-and-set. */
export class SqliteLeaseStore implements LeaseStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS leases (
        key TEXT PRIMARY KEY,
        holder TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  acquire(key: string, holder: string, ttlMs: number): boolean {
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cur = this.db.prepare('SELECT holder, expires_at FROM leases WHERE key = ?').get(key) as
        { holder: string; expires_at: number } | undefined;
      if (cur && cur.expires_at > now && cur.holder !== holder) {
        this.db.exec('COMMIT');
        return false;
      }
      this.db.prepare(
        'INSERT INTO leases (key, holder, expires_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at',
      ).run(key, holder, now + ttlMs);
      this.db.exec('COMMIT');
      return true;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  heartbeat(key: string, holder: string, ttlMs: number): boolean {
    const now = Date.now();
    const r = this.db.prepare(
      'UPDATE leases SET expires_at = ? WHERE key = ? AND holder = ? AND expires_at > ?',
    ).run(now + ttlMs, key, holder, now);
    return r.changes === 1;
  }

  release(key: string, holder: string): void {
    this.db.prepare('DELETE FROM leases WHERE key = ? AND holder = ?').run(key, holder);
  }

  close(): void {
    this.db.close();
  }
}
