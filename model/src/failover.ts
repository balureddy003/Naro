import { CapabilityNotSupportedError } from '@naro/core';
import type { ModelCapability } from './capabilities.ts';
import type { ChatChunk, ChatRequest, ChatResponse } from './messages.ts';
import type { Model } from './model.ts';

/**
 * Provider resilience, zero dependencies.
 *
 * `withRetry` retries transient failures on one model.
 * `failover` tries providers in order, and remembers who's down: after
 * `tripAfter` consecutive failures a model is skipped for `resetMs`
 * (half-open on expiry — the next call probes it). Capability checks use
 * the INTERSECTION of all models' capabilities, so a fallback can't claim
 * features it doesn't have.
 */

export interface RetryOptions {
  readonly attempts?: number;         // total tries, default 3
  readonly delayMs?: number;          // base delay, default 200
  readonly shouldRetry?: (e: unknown) => boolean;
}

const transient = (e: unknown): boolean =>
  !(e instanceof CapabilityNotSupportedError); // a missing capability is permanent, not transient

/** Retry a single call on one model. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const shouldRetry = opts.shouldRetry ?? transient;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === attempts - 1 || !shouldRetry(e)) throw e;
      await new Promise((r) => setTimeout(r, (opts.delayMs ?? 200) * 2 ** i));
    }
  }
  throw last;
}

interface Lane {
  model: Model;
  failures: number;
  openUntil: number;
}

/** A Model that fails over across providers with per-lane circuit breaking. */
export function failover(
  models: readonly Model[],
  opts: RetryOptions & { tripAfter?: number; resetMs?: number; nowMs?: () => number } = {},
): Model {
  if (models.length === 0) throw new Error('failover() needs at least one model');
  const tripAfter = opts.tripAfter ?? 2;
  const resetMs = opts.resetMs ?? 30_000;
  const now = opts.nowMs ?? Date.now;
  const lanes: Lane[] = models.map((model) => ({ model, failures: 0, openUntil: 0 }));

  // Honest surface: only what EVERY lane can do.
  const capabilities: ReadonlySet<ModelCapability> = new Set(
    [...models[0]!.capabilities].filter((c) => models.every((m) => m.capabilities.has(c))),
  );

  const attempt = async <T>(call: (m: Model) => Promise<T>): Promise<T> => {
    const errors: unknown[] = [];
    for (const lane of lanes) {
      if (lane.openUntil > now()) continue; // circuit open — skip
      try {
        const r = await call(lane.model);
        lane.failures = 0;                  // success resets the lane
        return r;
      } catch (e) {
        errors.push(e);
        if (!transient(e)) throw e;         // permanent failure isn't a failover case
        lane.failures++;
        if (lane.failures >= tripAfter) lane.openUntil = now() + resetMs;
      }
    }
    throw errors.at(-1) ?? new Error('all providers unavailable');
  };

  return {
    id: `failover(${models.map((m) => m.id).join(',')})`,
    provider: 'failover',
    capabilities,
    chat: (request: ChatRequest) => attempt((m) => m.chat(request)),
    ...(capabilities.has('streaming') && {
      stream: async function* (request: ChatRequest): AsyncIterable<ChatChunk> {
        // Failover applies to the stream START; once tokens flow, the lane owns the call.
        let chosen: Model | undefined;
        await attempt(async (m) => { chosen = m; });
        yield* chosen!.stream!(request);
      },
    }),
  };
}

/** A model wrapper adding retry on top of failover or a single provider. */
export function retrying(model: Model, opts: RetryOptions = {}): Model {
  return {
    ...model,
    chat: (request) => withRetry(() => model.chat(request), opts),
  };
}
