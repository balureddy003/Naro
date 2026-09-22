import type { NaroEvent, EventType, EventDataMap } from '@naro/core';
import { newId, hashEvent, GENESIS_HASH, signHead, publicKeyOf, SEAL_ALGORITHM } from '@naro/core';

export type EventHandler<T extends EventType | '*' = EventType | '*'> =
  (event: NaroEvent<Exclude<T, '*'>>) => void;

export interface EventBusOptions {
  /** Sequence to continue from — set when resuming a checkpointed run. */
  readonly seqStart?: number;
  /** Run identity stamped on every event; stable across resumes of one run. */
  readonly runId?: string;
  /** Chain head to link the first emitted event to — defaults to GENESIS_HASH. */
  readonly headStart?: string;
  /** Correlates this run with a parent run across delegation — defaults to this run's own `runId`. */
  readonly traceId?: string;
}

/**
 * The ordered event journal for a single agent run.
 *
 * Three guarantees:
 *  - payloads are *snapshots*: `emit` structured-clones data, so mutating
 *    an Action or Task later cannot rewrite history;
 *  - handlers are *isolated*: a throwing subscriber cannot crash the run —
 *    its error lands in `deliveryErrors` for inspection;
 *  - `history()` returns the full ordered journal for replay and export.
 */
export class EventBus {
  readonly runId: string;
  /** This run's trace id — a root run is the root of its own trace until `setTraceId` says otherwise. */
  traceId: string;
  private readonly handlers = new Map<string, Set<(e: NaroEvent) => void>>();
  private readonly log: NaroEvent[] = [];
  /** Handler failures, isolated rather than fatal. Inspectable for alerting. */
  readonly deliveryErrors: { readonly type: string; readonly error: unknown }[] = [];
  private seq: number;
  /** Hash of the last emitted event — the next event's `prev`. */
  private chainHead: string;

  private readonly scope: { readonly agentId: string; readonly goalId: string };

  constructor(
    scope: { readonly agentId: string; readonly goalId: string },
    opts: EventBusOptions = {},
  ) {
    this.scope = scope;
    this.runId = opts.runId ?? newId('run');
    this.traceId = opts.traceId ?? this.runId;
    this.seq = opts.seqStart ?? 1;
    this.chainHead = opts.headStart ?? GENESIS_HASH;
  }

  /** Subscribe to one event type, or '*' for all. Returns an unsubscribe fn. */
  on<T extends EventType | '*'>(
    type: T,
    handler: (e: T extends EventType ? NaroEvent<T> : NaroEvent) => void,
  ): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as (e: NaroEvent) => void);
    return () => set!.delete(handler as (e: NaroEvent) => void);
  }

  emit<T extends EventType>(type: T, data: EventDataMap[T]): NaroEvent<T> {
    const event = {
      id: newId('evt'),
      type,
      seq: this.seq++,
      at: Date.now(),
      agentId: this.scope.agentId,
      goalId: this.scope.goalId,
      runId: this.runId,
      traceId: this.traceId,
      // Snapshot: an event must never mutate after the fact.
      data: structuredClone(data),
      prev: this.chainHead,
    } as NaroEvent<T>;
    const hash = hashEvent(event);
    (event as { hash: string }).hash = hash;
    this.chainHead = hash;
    this.log.push(event as NaroEvent);
    for (const key of [type, '*'] as const) {
      for (const h of this.handlers.get(key) ?? []) {
        try { h(event as NaroEvent); }
        catch (error) { this.deliveryErrors.push({ type, error }); }
      }
    }
    return event;
  }

  /** Ordered journal — a copy, never the live array. */
  history(): readonly NaroEvent[] { return [...this.log]; }
  /** Next sequence number — persisted so resumes continue the ordering. */
  nextSeq(): number { return this.seq; }
  /** Hash-chain head — the next emitted event's `prev`. */
  head(): string { return this.chainHead; }

  /**
   * Continue a checkpointed run's journal: keep the original runId,
   * pick up the sequence where it left off, and (when `head` is given)
   * link the next event to the journal's chain — so the resumed events
   * read as one continuous audit trail rather than a fresh run.
   */
  resumeJournal(runId: string, seq: number, head?: string): void {
    (this as { runId: string }).runId = runId;
    this.seq = seq;
    if (head !== undefined) this.chainHead = head;
  }

  /**
   * Seal the journal: emit `journal.sealed` signing the current head with
   * an Ed25519 private key (PEM). The seal's `prev` IS the signed head, so
   * verification is self-contained — the embedded public key lets anyone
   * confirm this journal ends exactly where the key-holder left it.
   * Sealing is terminal by convention: emit nothing after it.
   */
  seal(privateKeyPem: string): NaroEvent<'journal.sealed'> {
    const head = this.chainHead;
    return this.emit('journal.sealed', {
      head,
      signature: signHead(head, privateKeyPem),
      publicKey: publicKeyOf(privateKeyPem),
      algorithm: SEAL_ALGORITHM,
    });
  }
}
