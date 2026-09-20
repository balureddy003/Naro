import { DatabaseSync } from 'node:sqlite';

/** The SQL port — Postgres/MySQL drivers satisfy the same contract. */
export interface SqlDriver {
  /** Parameterized read — returns rows. */
  query(sql: string, params?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
  /** Parameterized write — returns affected row count. */
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
  /** Table/column inventory for context. */
  schema(): Promise<readonly { table: string; columns: readonly string[] }[]>;
  close(): Promise<void>;
}

/** node:sqlite — real SQL in-process, zero external dependencies. */
export class NodeSqliteDriver implements SqlDriver {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
  }

  query(sql: string, params: readonly unknown[] = []): Promise<readonly Record<string, unknown>[]> {
    // node:sqlite returns null-prototype objects — normalize to plain
    // objects so callers can deepEqual, JSON-round-trip, etc.
    const rows = this.db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
    return Promise.resolve(rows.map((r) => ({ ...r })));
  }

  exec(sql: string, params: readonly unknown[] = []): Promise<{ changes: number }> {
    const r = this.db.prepare(sql).run(...(params as never[]));
    return Promise.resolve({ changes: Number(r.changes) });
  }

  schema(): Promise<readonly { table: string; columns: readonly string[] }[]> {
    const tables = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    ).all() as { name: string }[];
    return Promise.resolve(tables.map((t) => ({
      table: t.name,
      columns: (this.db.prepare(`PRAGMA table_info(${JSON.stringify(t.name)})`).all() as { name: string }[])
        .map((c) => c.name),
    })));
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}
