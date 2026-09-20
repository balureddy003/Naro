import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Authentication for the HTTP bus.
 *
 * `TokenVerifier` is the seam: the static shared-token option is sugar for
 * the simplest verifier; `hmacTokenVerifier` gives real signed-token auth
 * with expiry — zero dependencies. An OIDC/JWKS verifier (via `jose` or
 * your IdP's SDK) plugs into the same hook for production fleets.
 */

export type TokenVerifier = (token: string | undefined) => boolean | Promise<boolean>;

/** Constant-time shared-secret check — dev/test deployments. */
export function sharedTokenVerifier(expected: string): TokenVerifier {
  const want = Buffer.from(expected);
  return (token) => {
    if (token === undefined) return false;
    const got = Buffer.from(token);
    return got.length === want.length && timingSafeEqual(got, want);
  };
}

const b64url = (s: string): Buffer => Buffer.from(s, 'base64url');

/**
 * Verifies HS256 JWTs — the same signature shape most IdPs and internal
 * token minters already produce. Checks: well-formed structure, alg=HS256
 * (no alg-confusion), valid signature, and `exp` not in the past.
 * Optional `iss`/`aud` pinning.
 */
export function hmacTokenVerifier(
  secret: string,
  opts: { issuer?: string; audience?: string; nowMs?: () => number } = {},
): TokenVerifier {
  const now = opts.nowMs ?? Date.now;
  return (token) => {
    if (!token) return false;
    const [h, p, sig] = token.split('.');
    if (!h || !p || !sig) return false;

    let header: { alg?: string };
    let payload: { exp?: number; iss?: string; aud?: string | string[] };
    try {
      header = JSON.parse(b64url(h).toString('utf8'));
      payload = JSON.parse(b64url(p).toString('utf8'));
    } catch {
      return false;
    }
    if (header.alg !== 'HS256') return false; // reject 'none' and algorithm confusion

    const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
    const got = b64url(sig);
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return false;

    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now()) return false;
    if (opts.issuer !== undefined && payload.iss !== opts.issuer) return false;
    if (opts.audience !== undefined) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.includes(opts.audience)) return false;
    }
    return true;
  };
}

/** Mint an HS256 JWT — tests and small internal deployments. */
export function signHs256(payload: Record<string, unknown>, secret: string): string {
  const enc = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
