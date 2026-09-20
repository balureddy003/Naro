import type { NaroEvent, EventType, EventDataMap } from '@naro/core';
import { newId } from '@naro/core';

export type EventHandler<T extends EventType | '*' = EventType | '*'> =
  (event: NaroEvent<Exclude<T, '*'>>) => void;

export interface EventBusOptions {
  /** Sequence to continue from — set when resuming a checkpointed run. */
  readonly seqStart?: number;
  /** Run identity stamped on every event; stable across resumes of one run. */
  readonly runId?: string;
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
  private readonly handlers = new Map<string, Set<(e: NaroEvent) => void>>();
  private readonly log: NaroEvent[] = [];
  /** Handler failures, isolated rather than fatal. Inspectable for alerting. */
  readonly deliveryErrors: { readonly type: string; readonly error: unknown }[] = [];
  private seq: number;

  private readonly scope: { readonly agentId: string; readonly goalId: string };

  constructor(
    scope: { readonly agentId: string; readonly goalId: string },
    opts: EventBusOptions = {},
  ) {
    this.scope = scope;
    this.runId = opts.runId ?? newId('run');
    this.seq = opts.seqStart ?? 1;
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
      // Snapshot: an event must never mutate after the fact.
      data: structuredClone(data),
    } as NaroEvent<T>;
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

  /**
   * Continue a checkpointed run's journal: keep the original runId and
   * pick up the sequence where it left off, so the resumed events read
   * as one continuous audit trail rather than a fresh run.
   */
  resumeJournal(runId: string, seq: number): void {
    (this as { runId: string }).runId = runId;
    this.seq = seq;
  }
}
