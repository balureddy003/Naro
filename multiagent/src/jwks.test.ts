import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { jwksVerifier } from './jwks.ts';
import { signHs256 } from './auth.ts';

// Real RSA keypair — the test signs with the private key, the verifier
// checks against the public JWK served by a fake JWKS endpoint.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as { kid?: string };
jwk.kid = 'test-key';

const signRs256 = (payload: Record<string, unknown>): string => {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = enc({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
  const body = enc(payload);
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${sig.toString('base64url')}`;
};

const jwksFetch = (url: string) => Promise.resolve(
  url.includes('openid-configuration')
    ? new Response(JSON.stringify({ jwks_uri: 'https://idp.example/jwks.json' }))
    : new Response(JSON.stringify({ keys: [jwk] })),
) as Promise<Response>;

test('verifies a real RS256 JWT against a JWKS endpoint', async () => {
  const v = jwksVerifier({ jwksUrl: 'https://idp.example/jwks.json', fetchImpl: jwksFetch as typeof fetch });
  const tok = signRs256({ sub: 'agent-1', exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(await v(tok), true);
});

test('discovery via issuer resolves jwks_uri', async () => {
  const v = jwksVerifier({ issuer: 'https://idp.example', fetchImpl: jwksFetch as typeof fetch });
  const tok = signRs256({ iss: 'https://idp.example', exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(await v(tok), true);
});

test('rejects expired, wrong-key, HS256-confusion, and garbage', async () => {
  const v = jwksVerifier({ jwksUrl: 'https://idp.example/jwks.json', fetchImpl: jwksFetch as typeof fetch });
  assert.equal(await v(signRs256({ exp: 1 })), false);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const badSig = (() => {
    const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const head = enc({ alg: 'RS256', kid: 'test-key' }), body = enc({ exp: 9999999999 });
    return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(other).toString('base64url')}`;
  })();
  assert.equal(await v(badSig), false);
  assert.equal(await v(signHs256({ exp: 9999999999 }, 'secret')), false); // alg confusion refused
  assert.equal(await v('junk'), false);
});

test('issuer/audience pinning', async () => {
  const v = jwksVerifier({
    jwksUrl: 'https://idp.example/jwks.json', issuer: 'https://idp.example', audience: 'naro-bus',
    fetchImpl: jwksFetch as typeof fetch,
  });
  const exp = Math.floor(Date.now() / 1000) + 60;
  assert.equal(await v(signRs256({ iss: 'https://idp.example', aud: 'naro-bus', exp })), true);
  assert.equal(await v(signRs256({ iss: 'https://evil.example', aud: 'naro-bus', exp })), false);
});
