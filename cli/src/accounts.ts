import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

/**
 * ADR 0027 — hosted signup, layered on `PrincipalStore` (ADR 0025) rather
 * than a second identity system: `serve.ts` provisions the new account as
 * a real `Principal` (`{id: accountId, roles: ['admin'], tenantId}`) the
 * moment it's created. This file owns only what `PrincipalStore` doesn't
 * already have: a password to check and a session to remember the browser
 * proved it once, so it doesn't have to prove it again on every request.
 *
 * Opt-in only — `ServeOptions.accountStore`/`.sessionStore` are additive,
 * wired from `--accounts-store`. A deployment that never passes that flag
 * (every self-hosted user today) never has this code path reachable.
 */

const scrypt = promisify(scryptCb);
const SCRYPT_KEYLEN = 64;
/** 30 days, sliding — refreshed on every resolved session (see `get()`
 *  below), matching "stay signed in" behavior a hosted product needs. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------- passwords ----------------

/** `scrypt(password, salt)` → `"<saltHex>:<hashHex>"`. Node's own
 *  recommended scrypt cost parameters (N=16384 is the `scrypt` default);
 *  a fresh random salt per account defeats rainbow tables; the digest is
 *  never compared with `===` (see `verifyPassword`) — timing matters for
 *  secret material. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (saltHex === undefined || hashHex === undefined) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;
  // Lengths must match before timingSafeEqual — it throws on a mismatch
  // rather than returning false, and the length check itself isn't secret.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// ---------------- accounts ----------------

export interface Account {
  readonly id: string;
  readonly email: string;
  readonly tenantId: string;
  readonly createdAt: number;
}

export interface AccountStore {
  /** Throws if the (case-insensitively normalized) email already exists. */
  create(email: string, passwordHash: string): Promise<Account>;
  /** For login — the stored hash plus enough identity to build a session. */
  findByEmail(email: string): Promise<(Account & { passwordHash: string }) | undefined>;
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
const genId = (prefix: string): string => `${prefix}_${randomBytes(8).toString('hex')}`;

export class EmailAlreadyRegisteredError extends Error {
  constructor() { super('an account with this email already exists'); this.name = 'EmailAlreadyRegisteredError'; }
}

export class InMemoryAccountStore implements AccountStore {
  private readonly byEmail = new Map<string, Account & { passwordHash: string }>();

  create(email: string, passwordHash: string): Promise<Account> {
    const norm = normalizeEmail(email);
    if (this.byEmail.has(norm)) return Promise.reject(new EmailAlreadyRegisteredError());
    const account = { id: genId('acct'), email: norm, tenantId: genId('tenant'), createdAt: Date.now(), passwordHash };
    this.byEmail.set(norm, account);
    return Promise.resolve(account);
  }

  findByEmail(email: string): Promise<(Account & { passwordHash: string }) | undefined> {
    return Promise.resolve(this.byEmail.get(normalizeEmail(email)));
  }
}

export class SqliteAccountStore implements AccountStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        tenant_id     TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      )
    `);
  }

  create(email: string, passwordHash: string): Promise<Account> {
    const norm = normalizeEmail(email);
    const existing = this.db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(norm);
    if (existing !== undefined) return Promise.reject(new EmailAlreadyRegisteredError());
    const account = { id: genId('acct'), email: norm, tenantId: genId('tenant'), createdAt: Date.now() };
    this.db.prepare(
      'INSERT INTO accounts (id, email, tenant_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(account.id, account.email, account.tenantId, passwordHash, account.createdAt);
    return Promise.resolve(account);
  }

  findByEmail(email: string): Promise<(Account & { passwordHash: string }) | undefined> {
    const row = this.db.prepare('SELECT id, email, tenant_id, password_hash, created_at FROM accounts WHERE email = ?')
      .get(normalizeEmail(email)) as { id: string; email: string; tenant_id: string; password_hash: string; created_at: number } | undefined;
    if (row === undefined) return Promise.resolve(undefined);
    return Promise.resolve({ id: row.id, email: row.email, tenantId: row.tenant_id, createdAt: row.created_at, passwordHash: row.password_hash });
  }

  close(): void { this.db.close(); }
}

// ---------------- sessions ----------------

export interface Session {
  readonly accountId: string;
  readonly principalId: string;
  readonly tenantId: string;
  readonly expiresAt: number;
}

export interface SessionStore {
  /** Returns the raw session id — the only time it's ever in plaintext
   *  outside the httpOnly cookie itself (hashed at rest, same discipline
   *  `PrincipalStore` applies to bearer tokens). */
  create(session: Omit<Session, 'expiresAt'>): Promise<string>;
  /** Undefined past expiry. A resolved session's expiry slides forward by
   *  `SESSION_TTL_MS` — "stay signed in while active." */
  get(sessionId: string): Promise<Session | undefined>;
  revoke(sessionId: string): Promise<void>;
}

const hashSessionId = (id: string): string => createHash('sha256').update(id).digest('hex');
const genSessionId = (): string => `naro_sess_${randomBytes(32).toString('base64url')}`;

export class InMemorySessionStore implements SessionStore {
  private readonly rows = new Map<string, Session>();

  create(session: Omit<Session, 'expiresAt'>): Promise<string> {
    const id = genSessionId();
    this.rows.set(hashSessionId(id), { ...session, expiresAt: Date.now() + SESSION_TTL_MS });
    return Promise.resolve(id);
  }

  get(sessionId: string): Promise<Session | undefined> {
    const key = hashSessionId(sessionId);
    const row = this.rows.get(key);
    if (row === undefined) return Promise.resolve(undefined);
    if (row.expiresAt < Date.now()) { this.rows.delete(key); return Promise.resolve(undefined); }
    const refreshed = { ...row, expiresAt: Date.now() + SESSION_TTL_MS };
    this.rows.set(key, refreshed);
    return Promise.resolve(refreshed);
  }

  revoke(sessionId: string): Promise<void> {
    this.rows.delete(hashSessionId(sessionId));
    return Promise.resolve();
  }
}

export class SqliteSessionStore implements SessionStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_hash TEXT PRIMARY KEY,
        account_id   TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        tenant_id    TEXT NOT NULL,
        expires_at   INTEGER NOT NULL
      )
    `);
  }

  create(session: Omit<Session, 'expiresAt'>): Promise<string> {
    const id = genSessionId();
    this.db.prepare(
      'INSERT INTO sessions (session_hash, account_id, principal_id, tenant_id, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).run(hashSessionId(id), session.accountId, session.principalId, session.tenantId, Date.now() + SESSION_TTL_MS);
    return Promise.resolve(id);
  }

  get(sessionId: string): Promise<Session | undefined> {
    const key = hashSessionId(sessionId);
    const row = this.db.prepare('SELECT account_id, principal_id, tenant_id, expires_at FROM sessions WHERE session_hash = ?')
      .get(key) as { account_id: string; principal_id: string; tenant_id: string; expires_at: number } | undefined;
    if (row === undefined) return Promise.resolve(undefined);
    if (row.expires_at < Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE session_hash = ?').run(key);
      return Promise.resolve(undefined);
    }
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE session_hash = ?').run(expiresAt, key);
    return Promise.resolve({ accountId: row.account_id, principalId: row.principal_id, tenantId: row.tenant_id, expiresAt });
  }

  revoke(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE session_hash = ?').run(hashSessionId(sessionId));
    return Promise.resolve();
  }

  close(): void { this.db.close(); }
}

// ---------------- login rate limiting ----------------

/**
 * In-process, per-replica sliding-window limiter on `/accounts/login` —
 * blunts credential-stuffing against the one endpoint that takes a
 * password. Honestly scoped, matching `dogfood/README.md`'s convention
 * for security claims: resets on restart, doesn't coordinate across
 * replicas. A real multi-replica hosted deployment needs a shared store
 * (Redis/Postgres) for this to hold under horizontal scaling — flagged
 * in ADR 0027 as follow-on work, not silently assumed solved here.
 */
export class LoginRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max = 5, windowMs = 5 * 60_000) {
    this.max = max;
    this.windowMs = windowMs;
  }

  private key(email: string, ip: string): string { return `${normalizeEmail(email)}|${ip}`; }

  /** True if another attempt is currently allowed. */
  allow(email: string, ip: string): boolean {
    const k = this.key(email, ip);
    const now = Date.now();
    const hits = (this.attempts.get(k) ?? []).filter((t) => now - t < this.windowMs);
    this.attempts.set(k, hits);
    return hits.length < this.max;
  }

  /** Counts one attempt against the window, unconditionally — the
   *  primitive both call sites below build on. */
  record(email: string, ip: string): void {
    const k = this.key(email, ip);
    const hits = this.attempts.get(k) ?? [];
    hits.push(Date.now());
    this.attempts.set(k, hits);
  }

  /** Login-specific naming for the same thing — only a *failed* login
   *  should count against the window (a correct password on the first
   *  try never should). Signup has no such distinction — every attempt,
   *  successful or not, is account creation, so it calls `record()`
   *  directly instead. */
  recordFailure(email: string, ip: string): void {
    this.record(email, ip);
  }

  /** Call after a successful login — a real login clears the counter so a
   *  person who mistypes twice then gets it right isn't left half-limited. */
  clear(email: string, ip: string): void {
    this.attempts.delete(this.key(email, ip));
  }
}
