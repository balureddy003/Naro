import type { Verification, VerifyInput, Verifier } from '@naro/core';
import type { JsonSchema } from '@naro/tools';
import { validate } from '@naro/tools';

/**
 * Verifiers turn "the model said it's done" into "here is the evidence."
 * Each is small on purpose — compose them for real checks.
 */

/** Pass if `result` (or the observation's output) validates against a schema. */
export class SchemaVerifier implements Verifier {
  readonly id = 'schema';
  private readonly schema: JsonSchema;
  private readonly target: 'result' | 'observation';

  constructor(schema: JsonSchema, target: 'result' | 'observation' = 'result') {
    this.schema = schema;
    this.target = target;
  }

  verify(input: VerifyInput): Verification {
    const value = this.target === 'result' ? input.result : input.observation?.output;
    if (value === undefined) return { ok: false, reason: `nothing to verify (${this.target} absent)` };
    const errors = validate(this.schema, value);
    return errors.length === 0
      ? { ok: true, evidence: { schemaValid: true } }
      : { ok: false, reason: errors.map((e) => `${e.path}: ${e.message}`).join('; ') };
  }
}

/** Wrap a domain predicate — tests, state reads, numeric comparisons. */
export class PredicateVerifier implements Verifier {
  readonly id: string;
  private readonly fn: (input: VerifyInput) =>
    boolean | { ok: boolean; reason?: string } | Promise<boolean | { ok: boolean; reason?: string }>;

  constructor(id: string, fn: PredicateVerifier['fn']) {
    this.id = id;
    this.fn = fn;
  }

  async verify(input: VerifyInput): Promise<Verification> {
    const r = await this.fn(input);
    return typeof r === 'boolean' ? { ok: r } : r;
  }
}

/** Run a shell command — exit 0 means verified. The classic "run the tests" verifier. */
export class CommandVerifier implements Verifier {
  readonly id = 'command';
  private readonly command: string;
  private readonly cwd?: string;
  private readonly timeoutMs: number;

  constructor(command: string, opts: { cwd?: string; timeoutMs?: number } = {}) {
    this.command = command;
    this.cwd = opts.cwd;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async verify(): Promise<Verification> {
    const { execFile } = await import('node:child_process');
    return new Promise<Verification>((resolve) => {
      execFile('sh', ['-c', this.command], {
        ...(this.cwd !== undefined && { cwd: this.cwd }),
        timeout: this.timeoutMs,
      }, (err, stdout, stderr) => {
        resolve(err
          ? { ok: false, reason: `exit ${(err as { code?: number }).code ?? '?'}: ${stderr.slice(-500)}` }
          : { ok: true, evidence: { stdout: stdout.slice(-1000) } });
      });
    });
  }
}

/** Ask a human — the highest-assurance verifier for irreversible outcomes. */
export class HumanVerifier implements Verifier {
  readonly id = 'human';
  private readonly ask: (question: string) => Promise<boolean>;

  constructor(ask: (question: string) => Promise<boolean>) {
    this.ask = ask;
  }

  async verify(input: VerifyInput): Promise<Verification> {
    const ok = await this.ask(
      `Verify goal "${input.goal.description}": claimed result ${JSON.stringify(input.result)} — accept?`,
    );
    return { ok, reason: ok ? undefined : 'human rejected' };
  }
}

/** Compose verifiers: `allOf` (every must pass) or `anyOf` (first pass wins). */
export function allOf(id: string, ...verifiers: readonly Verifier[]): Verifier {
  return {
    id,
    async verify(input) {
      const reasons: string[] = [];
      for (const v of verifiers) {
        const r = await v.verify(input);
        if (!r.ok) reasons.push(`${v.id}: ${r.reason ?? 'failed'}`);
      }
      return reasons.length === 0
        ? { ok: true, evidence: { passed: verifiers.map((v) => v.id) } }
        : { ok: false, reason: reasons.join(' | ') };
    },
  };
}

export function anyOf(id: string, ...verifiers: readonly Verifier[]): Verifier {
  return {
    id,
    async verify(input) {
      const reasons: string[] = [];
      for (const v of verifiers) {
        const r = await v.verify(input);
        if (r.ok) return r;
        reasons.push(`${v.id}: ${r.reason ?? 'failed'}`);
      }
      return { ok: false, reason: reasons.join(' | ') };
    },
  };
}

/** Run `v` only on the completion claim (`input.result`); action-level calls pass. */
export function atCompletion(v: Verifier): Verifier {
  return {
    id: v.id,
    async verify(input) {
      return input.result !== undefined ? v.verify(input) : { ok: true };
    },
  };
}

/** Run `v` only on action-level calls (`input.observation`); the completion claim passes. */
export function perAction(v: Verifier): Verifier {
  return {
    id: v.id,
    async verify(input) {
      return input.result === undefined ? v.verify(input) : { ok: true };
    },
  };
}
