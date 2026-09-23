import {
  createObservation,
  type Action, type ActionExecutor, type ExecContext, type Observation,
} from '@naro/core';
import { defaultSpawn, type SpawnFn } from './spawn.ts';

/**
 * OS-level isolation for an `ActionExecutor` — the container adapter
 * `@naro/tools`'s `SandboxedExecutor` names as what untrusted code that
 * "must not reach the filesystem/network at all" needs, because a worker
 * thread shares the host process's syscall surface and this doesn't.
 *
 * Contract: the image runs one action and exits. It reads one line of
 * `JSON.stringify({action, ctx})` from stdin and writes one line of
 * `JSON.stringify({ok: true, observation} | {ok: false, error})` to
 * stdout — the exact message shape `SandboxedExecutor`'s worker uses, so
 * an image built on `node:22-alpine` can reuse `tools/src/sandbox-worker.ts`
 * almost verbatim; any other language just needs to speak the same two
 * JSON shapes.
 */
export interface DockerSandboxOptions {
  /** Image that implements the stdin/stdout contract above. Must already
   *  be pulled/built — this adapter never runs `docker pull`. */
  readonly image: string;
  /** 'docker' binary path/name, or a compatible CLI (e.g. 'podman'). */
  readonly dockerBin?: string;
  /** Wall-clock cap per action — exceeded → SIGKILL. Default 30s. */
  readonly timeoutMs?: number;
  /** `--network`. Default 'none' — no network unless the caller opts in. */
  readonly network?: 'none' | 'bridge' | 'host' | string;
  /** `--memory`. Default '256m'. */
  readonly memory?: string;
  /** `--cpus`. Default '0.5'. */
  readonly cpus?: string;
  /** `--pids-limit`. Default 128 — caps fork-bombing inside the container. */
  readonly pidsLimit?: number;
  /** `--read-only` root filesystem. Default true; set false only when the
   *  image genuinely needs to write outside stdout (rare — prefer a tmpfs
   *  mount via `extraArgs` instead of disabling this). */
  readonly readOnlyRootfs?: boolean;
  /** Extra `docker run` args appended after the security flags — volume
   *  mounts, `--user`, env vars. The deployment's choice, not this
   *  adapter's default: nothing here narrows the container back open. */
  readonly extraArgs?: readonly string[];
  /** Injected for offline tests. Defaults to a real `child_process.spawn`. */
  readonly spawn?: SpawnFn;
}

export class DockerSandboxExecutor implements ActionExecutor {
  private readonly image: string;
  private readonly dockerBin: string;
  private readonly timeoutMs: number;
  private readonly network: string;
  private readonly memory: string;
  private readonly cpus: string;
  private readonly pidsLimit: number;
  private readonly readOnlyRootfs: boolean;
  private readonly extraArgs: readonly string[];
  private readonly spawn: SpawnFn;

  constructor(opts: DockerSandboxOptions) {
    this.image = opts.image;
    this.dockerBin = opts.dockerBin ?? 'docker';
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.network = opts.network ?? 'none';
    this.memory = opts.memory ?? '256m';
    this.cpus = opts.cpus ?? '0.5';
    this.pidsLimit = opts.pidsLimit ?? 128;
    this.readOnlyRootfs = opts.readOnlyRootfs ?? true;
    this.extraArgs = opts.extraArgs ?? [];
    this.spawn = opts.spawn ?? defaultSpawn;
  }

  async execute(action: Action, ctx: ExecContext): Promise<Observation> {
    // AbortSignal can't cross a process boundary as data — cancellation
    // here means killing the container, same posture as SandboxedExecutor
    // terminating its worker. secrets.resolve is a live callback, not
    // serializable either; the image gets refs, not resolved values, by
    // the same rule ExecContext.secrets documents for every executor.
    const { signal: _signal, secrets: _secrets, ...safeCtx } = ctx;
    const args = [
      'run', '--rm', '-i',
      `--network=${this.network}`,
      `--memory=${this.memory}`,
      `--cpus=${this.cpus}`,
      `--pids-limit=${this.pidsLimit}`,
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true',
      ...(this.readOnlyRootfs ? ['--read-only'] : []),
      ...this.extraArgs,
      this.image,
    ];

    const fail = (error: string): Observation => createObservation({
      actionId: action.id, source: action.target, kind: 'tool-result', success: false, error,
    });

    let result;
    try {
      result = await this.spawn(this.dockerBin, args, {
        input: JSON.stringify({ action, ctx: safeCtx }) + '\n',
        timeoutMs: this.timeoutMs,
      });
    } catch (e) {
      return fail(`docker spawn failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (result.timedOut) return fail(`sandbox timeout after ${this.timeoutMs}ms`);
    if (result.exitCode !== 0) {
      return fail(`container exited ${result.exitCode ?? 'null'}: ${lastLine(result.stderr) || lastLine(result.stdout) || '(no output)'}`);
    }

    const line = lastLine(result.stdout);
    if (!line) return fail('container produced no output');
    let parsed: { ok: boolean; observation?: Observation; error?: string };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      return fail(`container stdout was not the expected JSON contract: ${line.slice(0, 200)}`);
    }
    if (parsed.ok && parsed.observation) return parsed.observation;
    return fail(parsed.error ?? 'container reported failure with no error message');
  }
}

/** stdout/stderr can carry image startup noise before the contract line —
 *  the last non-empty line is the executor's own message, by convention
 *  with sandbox-worker.ts's single postMessage per run. */
function lastLine(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.at(-1) ?? '';
}
