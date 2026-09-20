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

  export(events: readonly NaroEvent[]): Promise<void> {
    // Serialize writes: events stay in seq order even under async churn.
    this.pending = this.pending.then(async () => {
      if (events.length === 0) return;
      await mkdir(dirname(this.file), { recursive: true });
      await appendFile(this.file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    });
    return this.pending;
  }

  flush(): Promise<void> {
    return this.pending;
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
): { stop: () => void; flush: () => Promise<void> } {
  const stop = bus.on('*', (e) => { void exporter.export([e]); });
  return { stop, flush: () => exporter.flush?.() ?? Promise.resolve() };
}
