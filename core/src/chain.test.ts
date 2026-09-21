import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, GENESIS_HASH, hashEvent, verifyChain } from './chain.ts';
import type { NaroEvent } from './events.ts';

/** Build a chained event: prev links to the previous event's hash. */
const ev = (seq: number, prev: string, data: object = { n: seq }): NaroEvent => {
  const base = {
    id: `e${seq}`, type: 'reasoning.started', seq, at: 1000 + seq,
    agentId: 'a1', goalId: 'g1', runId: 'r1', data, prev,
  };
  return { ...base, hash: hashEvent(base as Omit<NaroEvent, 'hash'>) } as NaroEvent;
};

const chain = (n: number, startSeq = 1, prev = GENESIS_HASH): NaroEvent[] => {
  const out: NaroEvent[] = [];
  let p = prev;
  for (let i = 0; i < n; i++) {
    const e = ev(startSeq + i, p);
    out.push(e);
    p = e.hash!;
  }
  return out;
};

test('canonicalize is key-order independent and drops undefined', () => {
  const a = canonicalize({ b: 1, a: { d: undefined, c: [3, 2] }, u: undefined });
  const b = canonicalize({ u: undefined, a: { c: [3, 2] }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":[3,2]},"b":1}');
  assert.equal(canonicalize('x'), '"x"');
  assert.equal(canonicalize(null), 'null');
});

test('a well-formed chain verifies ok with head', () => {
  const events = chain(4);
  const v = verifyChain(events);
  assert.equal(v.ok, true);
  assert.equal(v.length, 4);
  assert.equal(v.unchained, 0);
  assert.equal(v.head, events.at(-1)!.hash);
  assert.equal(events[0]!.prev, GENESIS_HASH);
});

test('mutating an event payload breaks the chain at that event', () => {
  const events = chain(4);
  events[1] = { ...events[1]!, data: { n: 'tampered' } } as unknown as NaroEvent;
  const v = verifyChain(events);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 2);
  assert.match(v.reason!, /hash mismatch at seq 2/);
});

test('deleting an event breaks the link at the next event', () => {
  const events = chain(4).filter((e) => e.seq !== 2);
  const v = verifyChain(events);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 3);
  assert.match(v.reason!, /broken link at seq 3/);
});

test('swapping two seq numbers invalidates the reordered hashes', () => {
  const events = chain(4);
  events[1] = { ...events[1]!, seq: 3 } as NaroEvent;
  events[2] = { ...events[2]!, seq: 2 } as NaroEvent;
  const v = verifyChain(events);
  assert.equal(v.ok, false);
});

test('legacy events without hashes are not a chain', () => {
  const legacy: NaroEvent[] = [1, 2, 3].map((seq) => ({
    id: `e${seq}`, type: 'agent.created', seq, at: seq,
    agentId: 'a', goalId: 'g', runId: 'r', data: { name: 'x' },
  }) as NaroEvent);
  const v = verifyChain(legacy);
  assert.equal(v.ok, false);
  assert.equal(v.unchained, 3);
  assert.match(v.reason!, /not hash-chained/);
});

test('expectPrev verifies a partial journal that starts mid-chain', () => {
  const full = chain(6);
  const tail = full.filter((e) => e.seq >= 5);
  const v = verifyChain(tail, { expectPrev: full[3]!.hash });
  assert.equal(v.ok, true);
  // Without the expected predecessor, the same tail must fail.
  assert.equal(verifyChain(tail).ok, false);
});

test('empty input is a trivially valid chain', () => {
  assert.deepEqual(verifyChain([]), { ok: true, length: 0, unchained: 0 });
});
