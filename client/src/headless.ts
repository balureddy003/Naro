import type { NaroClient } from './client.ts';
import type { ApprovalRequest, RunEvent, RunSummary } from './types.ts';

/**
 * Headless primitives: state machine + subscribe, zero rendering
 * opinion — the same split TanStack Query and Zag.js popularized
 * ("machines handle the logic, you handle the UI"). Every function here
 * returns a plain `() => void` unsubscribe; nothing assumes React, a
 * particular framework, or even a DOM.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WatchRunOptions {
  /** Resume after this seq instead of replaying the whole journal. */
  readonly since?: number;
  readonly onEvent: (event: RunEvent) => void;
  /** Called on a dropped connection before it retries — not fatal. */
  readonly onError?: (error: unknown) => void;
  /** Delay before reconnecting after a dropped connection. Default 1000ms. */
  readonly reconnectMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Tails a run's events, reconnecting from the last-seen seq on a dropped
 * connection instead of losing the cursor or re-replaying from zero.
 * Stops on its own once the run reaches a terminal event (the stream
 * ends cleanly, same as `NaroClient.streamEvents`).
 */
const TERMINAL_EVENTS = new Set(['agent.completed', 'agent.failed', 'agent.cancelled', 'agent.paused']);

export function watchRun(client: NaroClient, runId: string, opts: WatchRunOptions): () => void {
  const controller = new AbortController();
  let lastSeq = opts.since;
  let stopped = false;

  const loop = async (): Promise<void> => {
    while (!stopped) {
      let sawTerminal = false;
      try {
        for await (const e of client.streamEvents(runId, { since: lastSeq, signal: controller.signal })) {
          lastSeq = e.seq;
          opts.onEvent(e);
          if (TERMINAL_EVENTS.has(e.type)) sawTerminal = true;
        }
        // The HTTP response ended. That's completion only if the last
        // event was terminal — otherwise the connection merely dropped
        // (network blip, proxy timeout, server restart), and the run is
        // still going: reconnect from lastSeq instead of giving up.
        if (sawTerminal) return;
        if (!stopped) await sleep(opts.reconnectMs ?? 1000);
      } catch (e) {
        if (stopped || controller.signal.aborted) return;
        opts.onError?.(e);
        await sleep(opts.reconnectMs ?? 1000);
      }
    }
  };
  void loop();

  const stop = (): void => { stopped = true; controller.abort(); };
  opts.signal?.addEventListener('abort', stop, { once: true });
  return stop;
}

export interface PollOptions<T> {
  readonly intervalMs?: number;
  readonly onData: (data: T) => void;
  readonly onError?: (error: unknown) => void;
  readonly signal?: AbortSignal;
}

function poll<T>(fetcher: () => Promise<T>, opts: PollOptions<T>): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      opts.onData(await fetcher());
    } catch (e) {
      opts.onError?.(e);
    }
    if (!stopped) timer = setTimeout(() => void tick(), opts.intervalMs ?? 3000);
  };
  void tick();

  const stop = (): void => { stopped = true; if (timer !== undefined) clearTimeout(timer); };
  opts.signal?.addEventListener('abort', stop, { once: true });
  return stop;
}

/** Polls `GET /runs` on an interval. Default 3s. `traceId` scopes to one
 *  delegation tree, the same filter `NaroClient.listRuns` takes. */
export function pollRuns(client: NaroClient, opts: PollOptions<readonly RunSummary[]> & { traceId?: string }): () => void {
  return poll(() => client.listRuns({ ...(opts.traceId !== undefined && { traceId: opts.traceId }) }), opts);
}

/** Polls `GET /approvals` on an interval. Default 3s. */
export function pollApprovals(client: NaroClient, opts: PollOptions<readonly ApprovalRequest[]>): () => void {
  return poll(() => client.listApprovals(), opts);
}
