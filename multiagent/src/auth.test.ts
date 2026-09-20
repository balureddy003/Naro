import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Goal } from '@naro/core';
import { hmacTokenVerifier, sharedTokenVerifier, signHs256 } from './auth.ts';
import { HttpAgentBus } from './http-bus.ts';

const goal: Goal = { id: 'g1', description: 'ping', constraints: [], successCriteria: [], priority: 1, metadata: {} };
const SECRET = 'test-secret';

const setup = async (serveOpts: Parameters<HttpAgentBus['listen']>[0] = 0, opts = {}) => {
  const bus = new HttpAgentBus({ resolve: () => undefined, ...opts });
  bus.serve('worker', async (msg) => `echo:${msg.goal.description}`);
  const { url, close } = await bus.listen(serveOpts);
  return { url, close };
};

test('HS256 verifier accepts a valid signed token', () => {
  const v = hmacTokenVerifier(SECRET);
  const tok = signHs256({ sub: 'agent-1', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
  assert.equal(v(tok), true);
});

test('rejects wrong signature, expired, alg=none, and garbage', () => {
  const v = hmacTokenVerifier(SECRET);
  const exp = Math.floor(Date.now() / 1000) + 60;
  assert.equal(v(signHs256({ exp }, 'wrong-secret')), false);
  assert.equal(v(signHs256({ exp: 1 }, SECRET)), false); // expired
  assert.equal(v('abc.def.ghi'), false);
  assert.equal(v(undefined), false);
  // alg=none
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"exp":9999999999}').toString('base64url')}.`;
  assert.equal(v(none), false);
});

test('issuer and audience pinning', () => {
  const v = hmacTokenVerifier(SECRET, { issuer: 'naro-idp', audience: 'bus' });
  const exp = Math.floor(Date.now() / 1000) + 60;
  assert.equal(v(signHs256({ iss: 'naro-idp', aud: 'bus', exp }, SECRET)), true);
  assert.equal(v(signHs256({ iss: 'other', aud: 'bus', exp }, SECRET)), false);
  assert.equal(v(signHs256({ iss: 'naro-idp', aud: 'other', exp }, SECRET)), false);
});

test('bus: authenticated request succeeds; missing/bad tokens get 401', async () => {
  const verify = hmacTokenVerifier(SECRET);
  const good = signHs256({ exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
  const { url, close } = await setup(0, { authenticate: verify });

  const client = new HttpAgentBus({ resolve: () => url, tokenProvider: () => good });
  assert.equal(await client.request('worker', goal, 'caller'), 'echo:ping');

  const badClient = new HttpAgentBus({ resolve: () => url, tokenProvider: () => 'bad' });
  await assert.rejects(() => badClient.request('worker', goal, 'caller'), /401/);

  const noClient = new HttpAgentBus({ resolve: () => url });
  await assert.rejects(() => noClient.request('worker', goal, 'caller'), /401/);
  await close();
});

test('static token option still works — sugar over the verifier', async () => {
  const { url, close } = await setup(0, { token: 's3cret' });
  const client = new HttpAgentBus({ resolve: () => url, token: 's3cret' });
  assert.equal(await client.request('worker', goal, 'caller'), 'echo:ping');
  const bad = new HttpAgentBus({ resolve: () => url, token: 'nope' });
  await assert.rejects(() => bad.request('worker', goal, 'caller'), /401/);
  await close();
});

test('sharedTokenVerifier is constant-time-safe and length-safe', () => {
  const v = sharedTokenVerifier('abc');
  assert.equal(v('abc'), true);
  assert.equal(v('abd'), false);
  assert.equal(v('abcdd'), false);
  assert.equal(v(undefined), false);
});
