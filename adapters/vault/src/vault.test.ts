import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainSecrets, EnvSecretProvider } from '@naro/tools';
import { VaultSecretProvider } from './vault.ts';

function vaultReturning(data: Record<string, unknown>): typeof fetch {
  return (async () => ({
    ok: true, status: 200,
    json: async () => ({ data: { data, metadata: {} } }),
  })) as unknown as typeof fetch;
}

test('explicit #field resolves that key from KV v2 data', async () => {
  const provider = new VaultSecretProvider({
    url: 'http://vault:8200', token: 't',
    fetchImpl: vaultReturning({ api_key: 'sk-abc', other: 'x' }),
  });
  assert.equal(await provider.resolve('vault:apps/billing#api_key'), 'sk-abc');
});

test('a single-field secret resolves without #field', async () => {
  const provider = new VaultSecretProvider({
    url: 'http://vault:8200', fetchImpl: vaultReturning({ only: 'value' }),
  });
  assert.equal(await provider.resolve('vault:apps/solo'), 'value');
});

test('a multi-field secret without #field is ambiguous, not a guess', async () => {
  const provider = new VaultSecretProvider({
    url: 'http://vault:8200', fetchImpl: vaultReturning({ a: '1', b: '2' }),
  });
  assert.equal(await provider.resolve('vault:apps/multi'), undefined);
});

test('a non-string field value is JSON-stringified, not dropped', async () => {
  const provider = new VaultSecretProvider({
    url: 'http://vault:8200', fetchImpl: vaultReturning({ nested: { a: 1 } }),
  });
  assert.equal(await provider.resolve('vault:apps/x#nested'), '{"a":1}');
});

test('a ref outside the prefix is not this provider\'s to resolve', async () => {
  const provider = new VaultSecretProvider({ url: 'http://vault:8200', fetchImpl: vaultReturning({ x: '1' }) });
  assert.equal(await provider.resolve('env:OTHER'), undefined);
});

test('404 or unreachable Vault resolves to undefined, never throws', async () => {
  const missing = new VaultSecretProvider({
    url: 'http://vault:8200',
    fetchImpl: (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch,
  });
  assert.equal(await missing.resolve('vault:apps/nope#k'), undefined);

  const unreachable = new VaultSecretProvider({
    url: 'http://vault:8200',
    fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch,
  });
  assert.equal(await unreachable.resolve('vault:apps/x#k'), undefined);
});

test('token and namespace ride as headers on the read', async () => {
  let sentHeaders: Record<string, string> = {};
  const fetchImpl = (async (_url: string, init: { headers: Record<string, string> }) => {
    sentHeaders = init.headers;
    return { ok: true, status: 200, json: async () => ({ data: { data: { k: 'v' } } }) };
  }) as unknown as typeof fetch;
  const provider = new VaultSecretProvider({ url: 'http://vault:8200', token: 'tok', namespace: 'ns1', fetchImpl });
  await provider.resolve('vault:apps/x#k');
  assert.equal(sentHeaders['X-Vault-Token'], 'tok');
  assert.equal(sentHeaders['X-Vault-Namespace'], 'ns1');
});

test('reads are cached within the TTL and re-read after it expires', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ data: { data: { k: `v${calls}` } } }) };
  }) as unknown as typeof fetch;
  const provider = new VaultSecretProvider({ url: 'http://vault:8200', fetchImpl, ttlMs: 10 });
  assert.equal(await provider.resolve('vault:apps/x#k'), 'v1');
  assert.equal(await provider.resolve('vault:apps/x#k'), 'v1'); // cached, no second call
  assert.equal(calls, 1);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(await provider.resolve('vault:apps/x#k'), 'v2');
});

test('composes with chainSecrets — first hit wins, env: still works', async () => {
  process.env['NARO_TEST_SECRET'] = 'from-env';
  const chained = chainSecrets(
    new VaultSecretProvider({ url: 'http://vault:8200', fetchImpl: vaultReturning({ k: 'from-vault' }) }),
    new EnvSecretProvider(),
  );
  assert.equal(await chained.resolve('vault:apps/x#k'), 'from-vault');
  assert.equal(await chained.resolve('env:NARO_TEST_SECRET'), 'from-env');
  delete process.env['NARO_TEST_SECRET'];
});
