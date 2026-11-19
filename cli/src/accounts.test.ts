import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hashPassword, verifyPassword, InMemoryAccountStore, SqliteAccountStore,
  InMemorySessionStore, SqliteSessionStore, LoginRateLimiter, EmailAlreadyRegisteredError,
} from './accounts.ts';

test('hashPassword/verifyPassword: round-trips, rejects wrong password, never stores plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.ok(!hash.includes('correct horse'));
  assert.match(hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password entirely', hash), false);
});

test('hashPassword: two hashes of the same password differ (random salt)', async () => {
  const a = await hashPassword('same password same password');
  const b = await hashPassword('same password same password');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('same password same password', a), true);
  assert.equal(await verifyPassword('same password same password', b), true);
});

test('verifyPassword: malformed stored hash fails closed, not throws', async () => {
  assert.equal(await verifyPassword('anything', 'not-a-real-hash'), false);
  assert.equal(await verifyPassword('anything', ''), false);
});

for (const [label, makeStore] of [
  ['InMemoryAccountStore', () => new InMemoryAccountStore()],
  ['SqliteAccountStore', () => new SqliteAccountStore(join(mkdtempSync(join(tmpdir(), 'naro-acct-')), 'a.db'))],
] as const) {
  test(`${label}: create → findByEmail round-trips; duplicate email rejected; email normalized`, async () => {
    const store = makeStore();
    const created = await store.create('Owner@Example.com', 'hash-1');
    assert.equal(created.email, 'owner@example.com');
    assert.match(created.id, /^acct_/);
    assert.match(created.tenantId, /^tenant_/);

    const found = await store.findByEmail('OWNER@example.com');
    assert.equal(found?.id, created.id);
    assert.equal(found?.passwordHash, 'hash-1');

    await assert.rejects(store.create('owner@example.com', 'hash-2'), EmailAlreadyRegisteredError);
    assert.equal(await store.findByEmail('nobody@example.com'), undefined);
  });

  test(`${label}: two accounts get distinct ids and tenants`, async () => {
    const store = makeStore();
    const a = await store.create('a@example.com', 'h');
    const b = await store.create('b@example.com', 'h');
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.tenantId, b.tenantId);
  });
}

for (const [label, makeStore] of [
  ['InMemorySessionStore', () => new InMemorySessionStore()],
  ['SqliteSessionStore', () => new SqliteSessionStore(join(mkdtempSync(join(tmpdir(), 'naro-sess-')), 's.db'))],
] as const) {
  test(`${label}: create → get resolves; unknown id resolves to undefined; revoke kills it`, async () => {
    const store = makeStore();
    const id = await store.create({ accountId: 'acct_1', principalId: 'acct_1', tenantId: 'tenant_1' });
    assert.match(id, /^naro_sess_/);

    const session = await store.get(id);
    assert.equal(session?.accountId, 'acct_1');
    assert.equal(session?.tenantId, 'tenant_1');
    assert.ok(session!.expiresAt > Date.now());

    assert.equal(await store.get('naro_sess_totally-made-up'), undefined);

    await store.revoke(id);
    assert.equal(await store.get(id), undefined);
  });

  test(`${label}: a raw session id, once issued, is the only way to resolve it — the store never round-trips it back out`, async () => {
    const store = makeStore();
    const id = await store.create({ accountId: 'acct_1', principalId: 'acct_1', tenantId: 'tenant_1' });
    const session = await store.get(id);
    assert.ok(session !== undefined);
    assert.ok(!('sessionId' in session!) && !('id' in session!));
  });
}

test('LoginRateLimiter: allows up to max, then blocks; success clears the window; different key is independent', () => {
  const limiter = new LoginRateLimiter(3, 60_000);
  for (let i = 0; i < 3; i++) {
    assert.equal(limiter.allow('a@example.com', '1.1.1.1'), true);
    limiter.recordFailure('a@example.com', '1.1.1.1');
  }
  assert.equal(limiter.allow('a@example.com', '1.1.1.1'), false);
  // A different email or a different IP is a different key — not blocked.
  assert.equal(limiter.allow('b@example.com', '1.1.1.1'), true);
  assert.equal(limiter.allow('a@example.com', '2.2.2.2'), true);

  limiter.clear('a@example.com', '1.1.1.1');
  assert.equal(limiter.allow('a@example.com', '1.1.1.1'), true);
});

test('LoginRateLimiter: email matching is case-insensitive (same account, same limit)', () => {
  const limiter = new LoginRateLimiter(2, 60_000);
  limiter.recordFailure('Owner@Example.com', '1.1.1.1');
  limiter.recordFailure('owner@example.com', '1.1.1.1');
  assert.equal(limiter.allow('OWNER@EXAMPLE.COM', '1.1.1.1'), false);
});
