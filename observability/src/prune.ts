import {
  canonicalize, GENESIS_HASH, hashEvent, newId, publicKeyOf, signHead,
  type NaroEvent,
} from '@naro/core';

/**
 * Attested retention pruning — ADR 0018.
 *
 * Deleting journal rows directly leaves a chain indistinguishable from
 * tampering. This is the vocabulary for "removed on purpose": the store
 * writes a `journal.retention.pruned` marker as the journal's new first
 * row (prev = GENESIS, seq = the cutoff), then deletes the covered rows.
 * `verifyChain` re-anchors on `anchorHash` — the hash of the last removed
 * event — and reports the prune as a *disclosure*, never a clean chain.
 *
 * Optional capability: stores implement `prune()` only if they support it
 * — same pattern as optional model capabilities.
 */
export interface PruneOptions {
  /** Policy citation recorded on the marker — e.g. 'GDPR Art. 5(1)(e)'. */
  readonly policy?: string;
  /** Ed25519 private key (PEM): attests the canonical
   *  {anchorHash, prunedThroughSeq, prunedAt, policy} tuple — proof a
   *  specific key-holder authorized this prune, not just that it happened. */
  readonly sealKey?: string;
}

export interface PruneResult {
  /** Rows actually deleted (excludes the marker). */
  readonly pruned: number;
  /** Hash of the last removed event — the chain's new effective genesis. */
  readonly anchorHash: string;
}

export interface PrunableEventStore {
  prune(runId: string, throughSeq: number, opts?: PruneOptions): Promise<PruneResult>;
}

/** Terminal types — a live or paused run's journal must stay whole
 *  (it is the only path to `wake(runId)`; ADR 0007). */
const TERMINAL = new Set(['agent.completed', 'agent.failed', 'agent.cancelled']);

/**
 * Validate a prune request against a run's ordered events and compute the
 * anchor. Throws on: unknown run, non-terminal run, no chained event at
 * or before the cutoff, or a cutoff that would erase the terminal event
 * (nothing would survive to disclose against).
 */
export function planPrune(
  events: readonly NaroEvent[],
  throughSeq: number,
): { anchorHash: string; run: { agentId: string; goalId: string; runId: string } } {
  if (events.length === 0) throw new Error('unknown run — nothing to prune');
  const last = events[events.length - 1]!;
  if (!TERMINAL.has(last.type)) {
    throw new Error(`run is not terminal (last event '${last.type}') — pruning a live or paused journal would break wake()`);
  }
  const anchor = [...events].reverse().find((e) => e.seq <= throughSeq && e.hash !== undefined);
  if (anchor === undefined) {
    throw new Error(`no chained event at or before seq ${throughSeq} — nothing to anchor a prune on`);
  }
  if (anchor.seq >= last.seq) {
    throw new Error(`pruning through seq ${throughSeq} would erase the terminal event — a journal must survive to disclose the prune`);
  }
  return { anchorHash: anchor.hash!, run: { agentId: last.agentId, goalId: last.goalId, runId: last.runId } };
}

/** The marker row: a normal chained event whose data carries the disclosure. */
export function buildPruneMarker(
  run: { agentId: string; goalId: string; runId: string },
  throughSeq: number,
  anchorHash: string,
  opts: PruneOptions = {},
): NaroEvent<'journal.retention.pruned'> {
  const data: NaroEvent<'journal.retention.pruned'>['data'] = {
    prunedThroughSeq: throughSeq, anchorHash, prunedAt: Date.now(),
    ...(opts.policy !== undefined && { policy: opts.policy }),
  };
  if (opts.sealKey !== undefined) {
    data.signature = signHead(canonicalize(data), opts.sealKey);
    data.publicKey = publicKeyOf(opts.sealKey);
  }
  const unsigned = {
    id: newId('evt'), type: 'journal.retention.pruned' as const,
    seq: throughSeq, at: Date.now(),
    agentId: run.agentId, goalId: run.goalId, runId: run.runId,
    prev: GENESIS_HASH, data,
  };
  return { ...unsigned, hash: hashEvent(unsigned) };
}
