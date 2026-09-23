import { createHash } from 'node:crypto';
import type { NaroEvent } from './events.ts';
import { verifySeal } from './sign.ts';

/** The `prev` of a run's first event — the chain's fixed starting point. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * Deterministic JSON: object keys sorted recursively, `undefined`
 * properties dropped, arrays preserved in order. Two structurally
 * equal values always canonicalize to the same string — the property
 * a hash chain relies on.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => v === undefined ? 'null' : canonicalize(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalize(v)}`);
  }
  return `{${parts.join(',')}}`;
}

/** sha256 hex of an event's canonical form — the `hash` field's value. */
export function hashEvent(event: Omit<NaroEvent, 'hash'>): string {
  return createHash('sha256').update(canonicalize({
    id: event.id,
    type: event.type,
    seq: event.seq,
    at: event.at,
    agentId: event.agentId,
    goalId: event.goalId,
    runId: event.runId,
    data: event.data,
    prev: event.prev,
  })).digest('hex');
}

export interface ChainVerdict {
  readonly ok: boolean;
  readonly length: number;
  /** Hash of the last chained event — what a resumed journal links to. */
  readonly head?: string;
  /** Sequence number where the chain first broke, if it did. */
  readonly brokenAt?: number;
  readonly reason?: string;
  /** Events carrying no hash — written before chaining existed. */
  readonly unchained: number;
  /**
   * Present when the journal carries `journal.sealed`: `ok` means the seal
   * is the last chained event, signs the true head, and verifies against
   * the embedded public key. `publicKey` lets callers pin an expected key.
   */
  readonly sealed?: { readonly ok: boolean; readonly publicKey?: string; readonly reason?: string };
  /**
   * Present when the journal begins with `journal.retention.pruned`
   * (ADR 0018): the disclosed prune — verified chain continues from
   * `anchorHash`, not GENESIS. `attested` reports the Ed25519 signature
   * over {anchorHash, prunedThroughSeq, prunedAt, policy} when present.
   */
  readonly pruned?: {
    readonly throughSeq: number;
    readonly anchorHash: string;
    readonly at: number;
    readonly policy?: string;
    readonly attested?: { readonly ok: boolean; readonly publicKey?: string; readonly reason?: string };
  };
}

/**
 * Verify a journal's hash chain. Chained events must recompute to their
 * stored `hash` and link `prev` → the previous chained event's `hash`;
 * the first chained event links to `opts.expectPrev` (or GENESIS_HASH).
 * Unchained events are counted and skipped — a journal of *only* legacy
 * events fails with 'journal is not hash-chained'.
 */
export function verifyChain(
  events: readonly NaroEvent[],
  opts: { expectPrev?: string } = {},
): ChainVerdict {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  if (sorted.length === 0) return { ok: true, length: 0, unchained: 0 };

  // ADR 0018: a journal opened by `journal.retention.pruned` verifies from
  // the marker's anchorHash — the hash of the last removed event — rather
  // than GENESIS. The marker itself is a normal chained event (prev =
  // GENESIS); the disclosed prune is reported on the verdict, never hidden.
  let rest: NaroEvent[] = sorted;
  let pruned: ChainVerdict['pruned'];
  if (sorted[0]!.type === 'journal.retention.pruned') {
    const marker = sorted[0]!;
    const d = marker.data as {
      prunedThroughSeq: number; anchorHash: string; prunedAt: number;
      policy?: string; signature?: string; publicKey?: string;
    };
    if (marker.hash === undefined || hashEvent(marker) !== marker.hash) {
      return { ok: false, length: sorted.length, brokenAt: marker.seq, reason: 'retention marker hash mismatch', unchained: 0 };
    }
    if (marker.prev !== GENESIS_HASH) {
      return { ok: false, length: sorted.length, brokenAt: marker.seq, reason: 'retention marker does not open the journal', unchained: 0 };
    }
    let attested: NonNullable<typeof pruned>['attested'];
    if (d.signature !== undefined && d.publicKey !== undefined) {
      const { signature, publicKey, ...signed } = d;
      attested = verifySeal(canonicalize(signed), signature, publicKey)
        ? { ok: true, publicKey }
        : { ok: false, publicKey, reason: 'invalid prune attestation signature' };
      if (!attested.ok) {
        return { ok: false, length: sorted.length, brokenAt: marker.seq, reason: attested.reason, unchained: 0, pruned: { throughSeq: d.prunedThroughSeq, anchorHash: d.anchorHash, at: d.prunedAt, ...(d.policy !== undefined && { policy: d.policy }), attested } };
      }
    }
    pruned = {
      throughSeq: d.prunedThroughSeq, anchorHash: d.anchorHash, at: d.prunedAt,
      ...(d.policy !== undefined && { policy: d.policy }),
      ...(attested !== undefined && { attested }),
    };
    rest = sorted.slice(1);
  }

  let unchained = 0;
  let prev = pruned !== undefined ? pruned.anchorHash : (opts.expectPrev ?? GENESIS_HASH);
  let head: string | undefined;
  for (const e of rest) {
    if (e.hash === undefined) { unchained++; continue; }
    if (hashEvent(e) !== e.hash) {
      return { ok: false, length: sorted.length, brokenAt: e.seq,
        reason: `hash mismatch at seq ${e.seq}`, unchained, ...(head !== undefined && { head }) };
    }
    if (e.prev !== prev) {
      return { ok: false, length: sorted.length, brokenAt: e.seq,
        reason: `broken link at seq ${e.seq}`, unchained, ...(head !== undefined && { head }) };
    }
    head = e.hash;
    prev = e.hash;
  }
  if (rest.length > 0 && unchained === rest.length) {
    return { ok: false, length: sorted.length, unchained, reason: 'journal is not hash-chained', ...(pruned !== undefined && { pruned }) };
  }

  // Seal: a `journal.sealed` event must be the last chained event, sign the
  // head it links from, and verify against its embedded public key.
  const seal = [...sorted].reverse().find((e) => e.type === 'journal.sealed');
  let sealed: ChainVerdict['sealed'];
  if (seal !== undefined) {
    const d = seal.data as { head: string; signature: string; publicKey: string };
    const lastChained = [...sorted].reverse().find((e) => e.hash !== undefined);
    sealed =
      seal !== lastChained ? { ok: false, reason: 'events exist after the journal seal' }
      : d.head !== seal.prev ? { ok: false, reason: 'seal does not sign the chain head it links from' }
      : !verifySeal(d.head, d.signature, d.publicKey) ? { ok: false, reason: 'invalid seal signature' }
      : { ok: true, publicKey: d.publicKey };
    if (!sealed.ok) {
      return { ok: false, length: sorted.length, brokenAt: seal.seq,
        reason: sealed.reason ?? 'seal invalid', unchained, sealed, ...(head !== undefined && { head }) };
    }
  }
  return { ok: true, length: sorted.length, unchained,
    ...(head !== undefined && { head }), ...(sealed !== undefined && { sealed }),
    ...(pruned !== undefined && { pruned }) };
}
