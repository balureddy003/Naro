import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainSecrets, EnvSecretProvider, MapSecretProvider } from './secrets.ts';

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
