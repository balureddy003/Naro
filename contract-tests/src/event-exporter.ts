import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NaroEvent } from '@naro/core';

export interface EventExporterLike {
  export(events: readonly NaroEvent[]): Promise<void> | void;
  flush?(): Promise<void>;
}

const ev = (seq: number): NaroEvent => ({
  id: `e${seq}`, type: 'agent.created', seq, at: Date.now(),
  agentId: 'a1', goalId: 'g1', data: { name: 't' },
});

/** Exporters must accept batches, preserve order, and flush durably. */
export function eventExporterContract(
  name: string,
  make: () => EventExporterLike | Promise<EventExporterLike>,
  /** How to read back what was exported (for durable sinks). */
  readBack?: (exp: EventExporterLike) => Promise<readonly string[]>,
): void {
  test(`${name}: export() accepts an empty batch without error`, async () => {
    const exp = await make();
    await exp.export([]);
    await exp.flush?.();
  });

  test(`${name}: concurrent exports preserve seq order after flush`, async () => {
    const exp = await make();
    if (!readBack) return; // order is only observable for durable sinks
    const batches = [[ev(1), ev(2)], [ev(3)], [ev(4), ev(5)]];
    await Promise.all(batches.map((b) => exp.export(b)));
    await exp.flush?.();
    const lines = await readBack(exp);
    const seqs = lines.map((l) => (JSON.parse(l) as NaroEvent).seq);
    assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
  });
}
