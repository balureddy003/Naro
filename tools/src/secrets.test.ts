import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chainSecrets, EnvSecretProvider, FileSecretProvider, MapSecretProvider } from './secrets.ts';

test('env provider resolves env: refs only', async () => {
  process.env['NARO_TEST_SECRET'] = 's3kr3t';
  const p = new EnvSecretProvider();
  assert.equal(await p.resolve('env:NARO_TEST_SECRET'), 's3kr3t');
  assert.equal(await p.resolve('vault:other'), undefined);
  assert.equal(await p.resolve('env:MISSING'), undefined);
});

test('map provider + chaining — first hit wins', async () => {
  const map = new MapSecretProvider({ 'vault:api/key': 'from-map' });
  const chained = chainSecrets(map, new EnvSecretProvider());
  assert.equal(await chained.resolve('vault:api/key'), 'from-map');
  process.env['NARO_CHAIN'] = 'from-env';
  assert.equal(await chained.resolve('env:NARO_CHAIN'), 'from-env');
  assert.equal(await chained.resolve('nothing'), undefined);
});

test('file provider resolves file: refs — trimmed content, missing → undefined', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-secrets-'));
  try {
    const file = join(dir, 'api-key');
    await writeFile(file, '  sk-test-123\n');
    const p = new FileSecretProvider();
    assert.equal(await p.resolve(`file:${file}`), 'sk-test-123');
    assert.equal(await p.resolve(`file:${join(dir, 'nope')}`), undefined);
    assert.equal(await p.resolve('env:WHATEVER'), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file provider caches within the TTL, re-reads after it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-secrets-'));
  try {
    const file = join(dir, 'rotating');
    await writeFile(file, 'v1');
    const p = new FileSecretProvider('file:', 30); // tiny TTL for the test
    assert.equal(await p.resolve(`file:${file}`), 'v1');
    await writeFile(file, 'v2'); // a mounted-secret rotation mid-TTL
    assert.equal(await p.resolve(`file:${file}`), 'v1', 'cached within TTL');
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(await p.resolve(`file:${file}`), 'v2', 're-read after TTL');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
