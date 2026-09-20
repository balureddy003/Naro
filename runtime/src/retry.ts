import { TimeoutError } from './timeout.ts';

/**
 * Retry policy for flaky operations (model calls, tool executions).
 * Exponential backoff: delay grows by `backoffFactor` each attempt;
 * `jitter` spreads retries so many agents don't retry in lockstep.
 */
export interface RetryPolicy {
  /** Total attempts including the first. 1 = no retry. */
  readonly attempts: number;
  /** Initial delay between attempts, ms. */
  readonly delayMs: number;
  /** Multiplier applied per attempt (2 = doubling). Default 2. */
  readonly backoffFactor?: number;
  /** Randomize delay in [delay/2, delay] to avoid thundering herds. */
  readonly jitter?: boolean;
  /**
   * Decide whether an error is worth retrying. Default: everything EXCEPT
   * TimeoutError — a timed-out action may already have committed its side
   * effect, so blind retry can double-apply it. Retry timeouts only via an
   * explicit `shouldRetry`, and prefer tools marked `idempotent`.
   */
  readonly shouldRetry?: (error: unknown) => boolean;
}

export const noRetry: RetryPolicy = { attempts: 1, delayMs: 0 };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('aborted'));
    }, { once: true });
  });
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  signal?: AbortSignal,
): Promise<T> {
  const factor = policy.backoffFactor ?? 2;
  let delay = policy.delayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const willRetry = attempt < policy.attempts
        && (policy.shouldRetry?.(error) ?? !(error instanceof TimeoutError));
      if (!willRetry) break;
      const jittered = policy.jitter ? delay / 2 + Math.random() * (delay / 2) : delay;
      await sleep(jittered, signal);
      delay *= factor;
    }
  }
  throw lastError;
}
