import { Worker } from 'node:worker_threads';
import {
  createObservation,
  type Action,
  type ActionExecutor,
  type ExecContext,
  type Observation,
} from '@naro/core';

export interface SandboxOptions {
  /**
   * Module specifier loaded INSIDE the worker — must export
   * `createExecutor(): ActionExecutor`. Tool code never runs in the
   * host process: a crashing or runaway tool dies in its own heap.
   */
  readonly module: string;
  /**
   * worker_threads resource limits — heap caps enforced by V8.
   * e.g. { maxOldGenerationSizeMb: 64, stackSizeMb: 2 }
   */
  readonly limits?: {
    readonly maxOldGenerationSizeMb?: number;
    readonly maxYoungGenerationSizeMb?: number;
    readonly codeRangeSizeMb?: number;
    readonly stackSizeMb?: number;
  };
  /** Wall-clock cap per action — exceeded → worker terminated. */
  readonly timeoutMs?: number;
}

/**
 * Process-isolated action execution.
 *
 * Each action runs in a fresh worker thread: its own V8 heap (capped by
 * `limits`), its own module state, and a hard termination path — abort or
 * timeout kills the worker, no cleanup burden on the host. Observations
 * cross back over structured clone, so only data escapes the sandbox.
 *
 * This is thread isolation, not OS sandboxing: the worker shares the
 * process's syscall surface. Untrusted code that must not reach the
 * filesystem/network at all needs the container adapter — this boundary
 * stops crashes, leaks, and runaway resource use.
 */
export class SandboxedExecutor implements ActionExecutor {
  private readonly module: string;
  private readonly limits?: SandboxOptions['limits'];
  private readonly timeoutMs: number;

  constructor(opts: SandboxOptions) {
    this.module = opts.module;
    this.limits = opts.limits;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  execute(action: Action, ctx: ExecContext): Promise<Observation> {
    // The signal can't cross structured clone — cancellation here means
    // terminating the worker, which IS the cancellation mechanism.
    const { signal: _signal, ...safeCtx } = ctx;
    return new Promise<Observation>((resolve) => {
      const worker = new Worker(new URL('./sandbox-worker.ts', import.meta.url), {
        workerData: { module: this.module },
        resourceLimits: this.limits,
        // Inherit only the type-stripping flag — the parent's other flags
        // (test-runner, tls, snapshot) are invalid in workers.
        execArgv: process.execArgv.filter((a) => a.startsWith('--experimental-strip-types')),
      });

      let settled = false;
      const finish = (obs: Observation): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ctx.signal?.removeEventListener('abort', onAbort);
        void worker.terminate();
        resolve(obs);
      };
      const fail = (error: string): void => finish(createObservation({
        actionId: action.id, source: action.target,
        kind: 'tool-result', success: false, error,
      }));

      const timer = setTimeout(() => fail(`sandbox timeout after ${this.timeoutMs}ms`), this.timeoutMs);
      const onAbort = (): void => fail('sandbox terminated: aborted');
      ctx.signal?.addEventListener('abort', onAbort, { once: true });

      worker.on('message', (msg: { ok: boolean; observation?: Observation; error?: string }) => {
        if (msg.ok && msg.observation) finish(msg.observation);
        else fail(msg.error ?? 'sandbox produced no observation');
      });
      worker.on('error', (e: Error) => fail(`sandbox crashed: ${e.message}`));
      worker.on('exit', (code) => {
        if (!settled && code !== 0) fail(`sandbox exited with code ${code} — resource limit or crash`);
      });

      worker.postMessage({ action, ctx: safeCtx });
    });
  }
}
