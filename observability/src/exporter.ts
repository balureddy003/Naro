import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NaroEvent } from '@naro/core';

/**
 * Where the event stream goes. The bus is the source of truth; exporters
 * ship it outward — a file, a collector, an OTel pipeline (adapter).
 */
export interface EventExporter {
  export(events: readonly NaroEvent[]): Promise<void> | void;
  /** Wait for all queued writes to land. Call before reading the sink. */
  flush?(): Promise<void>;
}

/** Durable audit log: one JSON object per line. Replay = read back. */
export class JsonlExporter implements EventExporter {
  private readonly file: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  /** The first write failure, if any — surfaced by flush(), not fatal to the queue. */
  private writeError: unknown;

  export(events: readonly NaroEvent[]): Promise<void> {
    // Serialize writes so events stay in seq order. A failed write is
    // captured into `writeError` instead of poisoning the chain — later
    // exports still run; flush() reports what went wrong.
    this.pending = this.pending.then(async () => {
      if (events.length === 0 || this.writeError) return;
      try {
        await mkdir(dirname(this.file), { recursive: true });
        await appendFile(this.file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      } catch (e) {
        this.writeError = e;
      }
    });
    return this.pending;
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.writeError) throw this.writeError;
  }
}

/** Live tail to stdout — the human-facing stream. */
export class ConsoleExporter implements EventExporter {
  export(events: readonly NaroEvent[]): void {
    for (const e of events) console.log(`[${e.seq}] ${e.agentId} ${e.type}`);
  }
}

/**
 * Attach an exporter to a live bus: every event forwards as it happens.
 * Returns an unsubscribe function.
 */
export function pipeTo(
  bus: { on: (type: '*', handler: (e: NaroEvent) => void) => () => void },
  exporter: EventExporter,
): { stop: () => void; flush: () => Promise<void>; errors: readonly unknown[] } {
  // Export failures are telemetry problems, not agent problems: collect
  // them on the handle rather than letting rejections float unhandled.
  const errors: unknown[] = [];
  const stop = bus.on('*', (e) => {
    void Promise.resolve(exporter.export([e])).catch((err) => errors.push(err));
  });
  return {
    stop,
    flush: () => exporter.flush?.() ?? Promise.resolve(),
    errors,
  };
}
