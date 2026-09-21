import { readFile } from 'node:fs/promises';

/**
 * Secret resolution at the execution boundary.
 *
 * The rule: actions carry secret REFERENCES ('env:OPENAI_API_KEY'), never
 * values. The executor resolves them just-in-time via ctx.secrets, so
 * credentials never appear in transcripts, checkpoints, events, or
 * observations. observability/redact.ts is the safety net for accidents.
 */

export interface SecretProvider {
  resolve(ref: string): Promise<string | undefined>;
}

/** 'env:NAME' → process.env.NAME. The zero-config default. */
export class EnvSecretProvider implements SecretProvider {
  private readonly prefix: string;

  constructor(prefix = 'env:') {
    this.prefix = prefix;
  }

  resolve(ref: string): Promise<string | undefined> {
    if (!ref.startsWith(this.prefix)) return Promise.resolve(undefined);
    return Promise.resolve(process.env[ref.slice(this.prefix.length)]);
  }
}

/** Static map — tests and small deployments. */
export class MapSecretProvider implements SecretProvider {
  private readonly secrets: Readonly<Record<string, string>>;

  constructor(secrets: Readonly<Record<string, string>>) {
    this.secrets = secrets;
  }

  resolve(ref: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets[ref]);
  }
}

/**
 * 'file:/abs/path' → the file's content, trimmed. For mounted secrets —
 * a k8s secret volume, an agent-injected credential file.
 *
 * Reads are cached per path with a TTL (default 60s): mounted secrets
 * rotate underneath us via pod refresh, so the cache must expire — but
 * re-reading on every action would stat the filesystem on the hot path.
 * Misses are cached too; a bad ref doesn't become a per-action fs probe.
 */
export class FileSecretProvider implements SecretProvider {
  private readonly prefix: string;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, { value?: string; at: number }>();

  constructor(prefix = 'file:', ttlMs = 60_000) {
    this.prefix = prefix;
    this.ttlMs = ttlMs;
  }

  async resolve(ref: string): Promise<string | undefined> {
    if (!ref.startsWith(this.prefix)) return undefined;
    const path = ref.slice(this.prefix.length);
    const hit = this.cache.get(path);
    if (hit !== undefined && Date.now() - hit.at < this.ttlMs) return hit.value;
    let value: string | undefined;
    try {
      value = (await readFile(path, 'utf8')).trim();
    } catch {
      value = undefined; // unreadable/missing file → unresolved, not a crash
    }
    this.cache.set(path, { value, at: Date.now() });
    return value;
  }
}

/** Chains providers — first hit wins. 'vault:…' adapters slot in here. */
export function chainSecrets(...providers: readonly SecretProvider[]): SecretProvider {
  return {
    async resolve(ref) {
      for (const p of providers) {
        const v = await p.resolve(ref);
        if (v !== undefined) return v;
      }
      return undefined;
    },
  };
}
