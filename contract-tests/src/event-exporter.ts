import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NaroEvent } from '@naro/core';

export interface EventExporterLike {
  export(events: readonly NaroEvent[]): Promise<void> | void;
  flush?(): Promise<void>;
}

// ids are namespaced per test — a store shared across tests (one Pg
// table) must not let an earlier test's row shadow a later one's via
// ON CONFLICT.
const ev = (seq: number, ns = ''): NaroEvent => ({
  id: `${ns}e${seq}`, type: 'agent.created', seq, at: Date.now(),
  agentId: 'a1', goalId: 'g1',
    runId: 'r1', data: { name: 't' },
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
    const batches = [[ev(1, 'ord-'), ev(2, 'ord-')], [ev(3, 'ord-')], [ev(4, 'ord-'), ev(5, 'ord-')]];
    await Promise.all(batches.map((b) => exp.export(b)));
    await exp.flush?.();
    const lines = await readBack(exp);
    // A shared store may hold other tests' rows — filter to this test's ids.
    const seqs = lines.map((l) => (JSON.parse(l) as NaroEvent))
      .filter((e) => e.id.startsWith('ord-'))
      .map((e) => e.seq);
    assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
  });

  test(`${name}: hash-chain fields survive the round trip`, async () => {
    const exp = await make();
    if (!readBack) return;
    const chained = { ...ev(1, 'chain-'), prev: 'a'.repeat(64), hash: 'b'.repeat(64) };
    const legacy = ev(2, 'chain-'); // no prev/hash — must read back without phantom fields
    await exp.export([chained, legacy]);
    await exp.flush?.();
    const lines = await readBack(exp);
    const back = lines.map((l) => JSON.parse(l) as NaroEvent)
      .filter((e) => e.id.startsWith('chain-'));
    assert.equal(back[0]!.prev, 'a'.repeat(64));
    assert.equal(back[0]!.hash, 'b'.repeat(64));
    assert.equal(back[1]!.prev, undefined);
    assert.equal(back[1]!.hash, undefined);
  });
}
