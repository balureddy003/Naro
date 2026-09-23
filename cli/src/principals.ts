import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Principal } from './serve.ts';

/**
 * `PrincipalStore` — ADR 0025's port: live, admin-writable identity for
 * `naro serve`, in the same shape `RunRegistry`/`CheckpointStore` establish
 * for other durable control-plane state.
 *
 * When `ServeOptions.principalStore` is configured, auth resolves a bearer
 * token through the store on *every* request — a written change is live on
 * the next request, no restart. The static `principals` map and legacy
 * `token` shorthand remain the right choice for the gateway-fronted
 * deployment ADR 0012 scoped.
 *
 * Storage holds a SHA-256 hash + last-4 of each token, never the raw
 * token — the same "shown once" discipline `SqliteApprovalBridge` applies
 * to sensitive fields. `list()` returns `tokenLast4` for display; the raw
 * token exists only at issuance time (POST /admin/principals returns it
 * exactly once).
 */

/** A principal row as the store reports it — identity plus the token's
 *  last-4 display form. The raw token is never stored. */
export interface StoredPrincipal extends Principal {
  readonly id: string;
  readonly roles: ReadonlySet<string>;
  readonly tenantId?: string;
  readonly tokenLast4: string;
  readonly createdAt: number;
}

export interface PrincipalStore {
  /** Resolve a bearer token to its principal — the per-request auth path. */
  get(token: string): Promise<Principal | undefined>;
  /** All principals with token last-4 for display — never raw tokens. */
  list(): Promise<readonly StoredPrincipal[]>;
  /** Create or replace the principal a token resolves to. */
  upsert(token: string, principal: Principal): Promise<void>;
  /** Revoke a token by its raw value (e.g. a leaked token). */
  revoke(token: string): Promise<boolean>;
  /** Revoke by principal id — what DELETE /admin/principals/:id calls. */
  revokeById(id: string): Promise<boolean>;
}

/** `naro_` + 24 random bytes, base64url — unguessable, greppable. */
export function generateToken(): string {
  return `naro_${randomBytes(24).toString('base64url')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const last4 = (token: string): string => token.slice(-4);

const toPrincipal = (p: { id: string; roles: Iterable<string>; tenantId?: string }): Principal => ({
  id: p.id, roles: new Set(p.roles), ...(p.tenantId !== undefined && { tenantId: p.tenantId }),
});

/** Dev/test implementation — same semantics, nothing durable. */
export class InMemoryPrincipalStore implements PrincipalStore {
  private readonly rows = new Map<string, { last4: string; principal: { id: string; roles: string[]; tenantId?: string }; createdAt: number }>();

  get(token: string): Promise<Principal | undefined> {
    const row = this.rows.get(hashToken(token));
    return Promise.resolve(row === undefined ? undefined : toPrincipal(row.principal));
  }

  list(): Promise<readonly StoredPrincipal[]> {
    return Promise.resolve([...this.rows.values()].map((r) => ({
      ...toPrincipal(r.principal), tokenLast4: r.last4, createdAt: r.createdAt,
    })));
  }

  upsert(token: string, principal: Principal): Promise<void> {
    this.rows.set(hashToken(token), {
      last4: last4(token),
      principal: { id: principal.id, roles: [...principal.roles], ...(principal.tenantId !== undefined && { tenantId: principal.tenantId }) },
      createdAt: Date.now(),
    });
    return Promise.resolve();
  }

  revoke(token: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(hashToken(token)));
  }

  revokeById(id: string): Promise<boolean> {
    for (const [hash, row] of this.rows) {
      if (row.principal.id === id) { this.rows.delete(hash); return Promise.resolve(true); }
    }
    return Promise.resolve(false);
  }
}

/** The self-hosted default — one file, no separate database (ADR 0025). */
export class SqlitePrincipalStore implements PrincipalStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS principals (
        token_hash  TEXT PRIMARY KEY,
        token_last4 TEXT NOT NULL,
        principal   TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      )
    `);
  }

  get(token: string): Promise<Principal | undefined> {
    const row = this.db.prepare('SELECT principal FROM principals WHERE token_hash = ?')
      .get(hashToken(token)) as { principal: string } | undefined;
    if (row === undefined) return Promise.resolve(undefined);
    const p = JSON.parse(row.principal) as { id: string; roles: string[]; tenantId?: string };
    return Promise.resolve(toPrincipal(p));
  }

  list(): Promise<readonly StoredPrincipal[]> {
    const rows = this.db.prepare('SELECT token_last4, principal, created_at FROM principals ORDER BY created_at')
      .all() as { token_last4: string; principal: string; created_at: number }[];
    return Promise.resolve(rows.map((r) => ({
      ...toPrincipal(JSON.parse(r.principal) as { id: string; roles: string[]; tenantId?: string }),
      tokenLast4: r.token_last4, createdAt: r.created_at,
    })));
  }

  upsert(token: string, principal: Principal): Promise<void> {
    this.db.prepare(
      'INSERT OR REPLACE INTO principals (token_hash, token_last4, principal, created_at) VALUES (?, ?, ?, ?)',
    ).run(
      hashToken(token), last4(token),
      JSON.stringify({ id: principal.id, roles: [...principal.roles], ...(principal.tenantId !== undefined && { tenantId: principal.tenantId }) }),
      Date.now(),
    );
    return Promise.resolve();
  }

  revoke(token: string): Promise<boolean> {
    const r = this.db.prepare('DELETE FROM principals WHERE token_hash = ?').run(hashToken(token));
    return Promise.resolve(Number(r.changes) > 0);
  }

  revokeById(id: string): Promise<boolean> {
    const rows = this.db.prepare('SELECT token_hash, principal FROM principals').all() as { token_hash: string; principal: string }[];
    for (const row of rows) {
      if ((JSON.parse(row.principal) as { id: string }).id === id) {
        this.db.prepare('DELETE FROM principals WHERE token_hash = ?').run(row.token_hash);
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  close(): void {
    this.db.close();
  }
}
