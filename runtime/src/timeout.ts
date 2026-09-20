import { NaroError } from '@naro/core';

export class TimeoutError extends NaroError {
  constructor(ms: number) {
    super('timeout', `Operation timed out after ${ms}ms`);
  }
}

/**
 * Race a promise against a deadline. The underlying work is *not*
 * cancelled — cooperative cancellation is what AbortSignal is for —
 * but the caller stops waiting. Use both together.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
