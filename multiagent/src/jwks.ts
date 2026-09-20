import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';
import type { TokenVerifier } from './auth.ts';

/**
 * OIDC token verification: fetch the issuer's JWKS, verify RS256/ES256
 * signatures locally, check exp/iss/aud. Keys are cached and refreshed
 * on unknown kid or expiry — key rotation just works.
 *
 * Zero dependencies: JWK→KeyObject is native node:crypto. This is the
 * production answer to the TokenVerifier hook on HttpAgentBus.
 */
export interface JwksOptions {
  /** OIDC issuer — discovery fetches {iss}/.well-known/openid-configuration. */
  readonly issuer?: string;
  /** Or point straight at the JWKS document. */
  readonly jwksUrl?: string;
  readonly audience?: string;
  /** Key cache lifetime (default 10 min) — also refreshed on unknown kid. */
  readonly cacheMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly nowMs?: () => number;
}

interface Jwk {
  kty: string; kid?: string; alg?: string; use?: string;
  n?: string; e?: string; x?: string; y?: string; crv?: string;
}

export function jwksVerifier(opts: JwksOptions): TokenVerifier {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.nowMs ?? Date.now;
  const cacheMs = opts.cacheMs ?? 600_000;
  let keys = new Map<string, KeyObject>();
  let keysAt = 0;
  let jwksUrl = opts.jwksUrl;

  const loadKeys = async (): Promise<void> => {
    if (!jwksUrl) {
      if (!opts.issuer) throw new Error('jwksVerifier needs issuer or jwksUrl');
      const disco = await fetchImpl(`${opts.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
      if (!disco.ok) throw new Error(`OIDC discovery failed: ${disco.status}`);
      jwksUrl = (await disco.json() as { jwks_uri: string }).jwks_uri;
    }
    const res = await fetchImpl(jwksUrl);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const { keys: jwks } = await res.json() as { keys: Jwk[] };
    keys = new Map(
      jwks.filter((k) => k.kid).map((k) => [k.kid!, createPublicKey({ key: k as never, format: 'jwk' })]),
    );
    keysAt = now();
  };

  return async (token) => {
    if (!token) return false;
    const [h, p, sig] = token.split('.');
    if (!h || !p || !sig) return false;

    let header: { alg?: string; kid?: string };
    let payload: { exp?: number; iss?: string; aud?: string | string[] };
    try {
      header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    } catch { return false; }

    // Pinned algorithm set — no 'none', no HS confusion with the HMAC secret.
    const alg = header.alg;
    if (alg !== 'RS256' && alg !== 'ES256') return false;

    if (now() - keysAt > cacheMs || !header.kid || !keys.has(header.kid)) {
      try { await loadKeys(); } catch { return false; }
    }
    const key = header.kid ? keys.get(header.kid) : undefined;
    if (!key) return false;

    // JWT ECDSA signatures are raw R||S (IEEE-P1363), not DER.
    const verifier = createVerify(alg === 'RS256' ? 'RSA-SHA256' : 'SHA256').update(`${h}.${p}`);
    const ok = alg === 'RS256'
      ? verifier.verify(key, Buffer.from(sig, 'base64url'))
      : verifier.verify({ key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
    if (!ok) return false;

    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now()) return false;
    if (opts.issuer !== undefined && payload.iss !== opts.issuer) return false;
    if (opts.audience !== undefined) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.includes(opts.audience)) return false;
    }
    return true;
  };
}
