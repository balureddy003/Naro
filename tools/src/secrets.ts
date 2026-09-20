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
