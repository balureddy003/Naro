import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateToken, hashToken, InMemoryPrincipalStore, SqlitePrincipalStore, type PrincipalStore } from './principals.ts';

const principal = { id: 'sam', roles: new Set(['viewer', 'operator']), tenantId: 'riverside' };

for (const make of [
  { name: 'InMemoryPrincipalStore', make: async () => new InMemoryPrincipalStore() },
  { name: 'SqlitePrincipalStore', make: async () => {
    const dir = await mkdtemp(join(tmpdir(), 'naro-principals-'));
    const store = new SqlitePrincipalStore(join(dir, 'p.db'));
    return Object.assign(store, { dir });
  } },
]) {
  test(`${make.name}: upsert → get → list → revoke round-trip`, async () => {
    const store = (await make.make()) as PrincipalStore & { dir?: string; close?: () => void };
    try {
      const token = generateToken();
      assert.match(token, /^naro_[A-Za-z0-9_-]+$/);

      assert.equal(await store.get(token), undefined);
      await store.upsert(token, principal);
      const got = await store.get(token);
      assert.equal(got?.id, 'sam');
      assert.ok(got?.roles.has('operator'));
      assert.equal(got?.tenantId, 'riverside');

      // list() exposes last-4 for display, never the raw token or its hash.
      const list = await store.list();
      assert.equal(list.length, 1);
      assert.equal(list[0]!.tokenLast4, token.slice(-4));
      assert.ok(!('token' in list[0]!));
      assert.ok(!('tokenHash' in list[0]!));

      assert.equal(await store.revoke(token), true);
      assert.equal(await store.get(token), undefined);
      assert.equal(await store.revoke(token), false);
    } finally {
      store.close?.();
      if (store.dir !== undefined) await rm(store.dir, { recursive: true, force: true });
    }
  });

  test(`${make.name}: revokeById removes the principal's token`, async () => {
    const store = (await make.make()) as PrincipalStore & { dir?: string; close?: () => void };
    try {
      const token = generateToken();
      await store.upsert(token, { id: 'riley', roles: new Set(['viewer']) });
      assert.equal(await store.revokeById('riley'), true);
      assert.equal(await store.get(token), undefined);
      assert.equal(await store.revokeById('riley'), false);
    } finally {
      store.close?.();
      if (store.dir !== undefined) await rm(store.dir, { recursive: true, force: true });
    }
  });
}

test('hashToken is sha256 — the store never persists the raw token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-principals-'));
  try {
    const path = join(dir, 'p.db');
    const store = new SqlitePrincipalStore(path);
    const token = generateToken();
    await store.upsert(token, principal);
    store.close();

    // Reading the table directly proves what's at rest: hash + last4, not token.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path);
    const row = db.prepare('SELECT token_hash, token_last4, principal FROM principals').get() as { token_hash: string; token_last4: string; principal: string };
    db.close();
    assert.equal(row.token_hash, hashToken(token));
    assert.equal(row.token_last4, token.slice(-4));
    assert.ok(!row.principal.includes(token));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
