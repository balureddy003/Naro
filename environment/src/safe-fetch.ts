import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * fetchAllowlisted — an SSRF-resistant fetch for agent-facing environments.
 *
 * Checking the requested URL once is not enough: an allowlisted host can
 * redirect anywhere, and an allowlisted name can resolve to a private
 * address (metadata endpoints, intranet). So every hop is revalidated:
 *
 *  1. protocol must be http/https;
 *  2. hostname must be in `allowedDomains` (exact or subdomain);
 *  3. resolved IPs must not be private/loopback/link-local/reserved
 *     (skipped when DNS fails — the allowlist is still enforced);
 *  4. redirects are followed MANUALLY, each hop through the same checks.
 */
export interface SafeFetchOptions {
  readonly allowedDomains: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Redirect hops to follow before giving up. Default 5. */
  readonly maxRedirects?: number;
  /** Allow private/loopback targets (dev/test). Default false. */
  readonly allowPrivateHosts?: boolean;
  readonly signal?: AbortSignal;
}

const PRIVATE_V4 = [
  /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^198\.1[89]\./,
  /^224\./, /^240\./,
];
const PRIVATE_V6 = ['::1', 'fc', 'fd', 'fe80'];

function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (PRIVATE_V4.some((re) => re.test(v))) return true;
  return PRIVATE_V6.some((p) => v === '::1' || v.startsWith(p));
}

export function domainAllowed(hostname: string, allowed: readonly string[]): boolean {
  return allowed.some((d) => hostname === d || hostname.endsWith(`.${d}`));
}

async function resolvePrivate(hostname: string): Promise<boolean> {
  // Literal IPs skip DNS entirely.
  if (isIP(hostname)) return isPrivateIp(hostname);
  try {
    const addrs = await lookup(hostname, { all: true });
    return addrs.some((a) => isPrivateIp(a.address));
  } catch {
    return false; // unresolvable — allowlist check still applied; fetch will fail
  }
}

export async function fetchAllowlisted(
  url: string,
  opts: SafeFetchOptions,
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try { parsed = new URL(current); } catch {
      throw new Error(`invalid URL '${current}'`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`protocol '${parsed.protocol}' not allowed`);
    }
    if (!domainAllowed(parsed.hostname, opts.allowedDomains)) {
      throw new Error(
        `domain '${parsed.hostname}' not in allowlist (${opts.allowedDomains.join(', ') || 'empty'})`);
    }
    if (!opts.allowPrivateHosts && await resolvePrivate(parsed.hostname)) {
      throw new Error(`host '${parsed.hostname}' resolves to a private/reserved address`);
    }

    const res = await doFetch(current, {
      redirect: 'manual',
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      // Re-loop: the Location target goes through every check again.
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error(`redirect limit (${maxRedirects}) exceeded`);
}

/** Read a response body as text with a hard byte cap — don't buffer the world. */
export async function boundedText(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: await res.text(), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: merged.toString('utf8'), truncated };
}
