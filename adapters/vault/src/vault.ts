import type { SecretProvider } from '@naro/tools';

/**
 * HashiCorp Vault adapter for `chainSecrets()` — the extension point
 * `@naro/tools`'s `secrets.ts` names directly ('vault:… adapters slot in
 * here').
 *
 * Ref shape: `vault:<path-under-mount>[#<field>]`, e.g.
 * `vault:apps/billing/prod#stripe_key`. KV v2 secrets are JSON objects, so
 * a bare path is only unambiguous when it holds exactly one field —
 * anything else without `#field` resolves to undefined rather than
 * guessing which key the caller meant.
 */
export interface VaultOptions {
  /** Vault base URL, e.g. 'https://vault.example.com:8200'. */
  readonly url: string;
  /** Static token. Omit when auth is handled entirely via `headers`
   *  (a Vault Agent sidecar, a token fetched by AppRole externally). */
  readonly token?: string;
  /** KV v2 mount point. Default 'secret'. */
  readonly mount?: string;
  /** Ref prefix. Default 'vault:'. */
  readonly prefix?: string;
  /** Vault Enterprise namespace, if any. */
  readonly namespace?: string;
  readonly headers?: Record<string, string>;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Cache TTL, like FileSecretProvider — a Vault read is a network call
   *  on the hot path otherwise, and a rotated secret must still surface
   *  within a bounded window. Default 60s. */
  readonly ttlMs?: number;
}

export class VaultSecretProvider implements SecretProvider {
  private readonly opts: VaultOptions;
  private readonly prefix: string;
  private readonly mount: string;
  private readonly ttlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, { value?: string; at: number }>();

  constructor(opts: VaultOptions) {
    this.opts = opts;
    this.prefix = opts.prefix ?? 'vault:';
    this.mount = opts.mount ?? 'secret';
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async resolve(ref: string): Promise<string | undefined> {
    if (!ref.startsWith(this.prefix)) return undefined;
    const rest = ref.slice(this.prefix.length);
    const hit = this.cache.get(rest);
    if (hit !== undefined && Date.now() - hit.at < this.ttlMs) return hit.value;

    const hashIndex = rest.lastIndexOf('#');
    const path = hashIndex === -1 ? rest : rest.slice(0, hashIndex);
    const field = hashIndex === -1 ? undefined : rest.slice(hashIndex + 1);

    const value = await this.read(path, field);
    this.cache.set(rest, { value, at: Date.now() });
    return value;
  }

  private async read(path: string, field: string | undefined): Promise<string | undefined> {
    try {
      const res = await this.fetchImpl(`${this.opts.url}/v1/${this.mount}/data/${path}`, {
        headers: {
          ...(this.opts.token !== undefined && { 'X-Vault-Token': this.opts.token }),
          ...(this.opts.namespace !== undefined && { 'X-Vault-Namespace': this.opts.namespace }),
          ...this.opts.headers,
        },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5_000),
      });
      // Missing, denied, or unreachable → unresolved, not a crash — the
      // same posture FileSecretProvider takes for a missing file.
      if (!res.ok) return undefined;
      const body = await res.json() as { data?: { data?: Record<string, unknown> } };
      const data = body.data?.data;
      if (!data) return undefined;
      if (field !== undefined) return stringify(data[field]);
      const keys = Object.keys(data);
      return keys.length === 1 ? stringify(data[keys[0]!]) : undefined;
    } catch {
      return undefined;
    }
  }
}

function stringify(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}
