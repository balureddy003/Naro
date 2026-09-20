import {
  newId,
  type EventDataMap,
  type EventType,
  type NaroEvent,
} from '@naro/core';

export type EventHandler<T extends EventType = EventType> = (event: NaroEvent<T>) => void;

/**
 * The agent's nervous system: everything that happens is emitted here.
 *
 * The bus does two jobs:
 *  1. **Live streaming** — subscribers see events as they occur (UI, logging).
 *  2. **Ordered history** — `seq` gives a total order per agent, which is
 *     what makes replay, audit, and evaluation possible.
 *
 * It is deliberately tiny. Bigger systems (Kafka, OTel exporters) subscribe
 * to this bus rather than replacing it.
 */
export class EventBus {
  private seq = 0;
  private readonly log: NaroEvent[] = [];
  private readonly wildcard = new Set<EventHandler>();
  private readonly byType = new Map<EventType, Set<EventHandler>>();
  private readonly scope: { readonly agentId: string; readonly goalId: string };

  constructor(scope: { readonly agentId: string; readonly goalId: string }) {
    this.scope = scope;
  }

  /** Emit an event. Returns the event that was recorded. */
  emit<T extends EventType>(type: T, data: EventDataMap[T]): NaroEvent<T> {
    const event = {
      id: newId('evt'),
      type,
      seq: ++this.seq,
      at: Date.now(),
      agentId: this.scope.agentId,
      goalId: this.scope.goalId,
      data,
    } as NaroEvent<T>;
    this.log.push(event);
    // Specific listeners first — they may react; wildcards are observers.
    for (const handler of this.byType.get(type) ?? []) handler(event);
    for (const handler of this.wildcard) handler(event);
    return event;
  }

  /** Subscribe to one event type, or '*' for everything. Returns unsubscribe. */
  on<T extends EventType>(type: T | '*', handler: EventHandler<T>): () => void {
    if (type === '*') {
      const h = handler as unknown as EventHandler;
      this.wildcard.add(h);
      return () => this.wildcard.delete(h);
    }
    let set = this.byType.get(type);
    if (!set) this.byType.set(type, (set = new Set()));
    const h = handler as unknown as EventHandler;
    set.add(h);
    return () => set!.delete(h);
  }

  /** The full ordered record of this run — the audit trail. */
  history(): readonly NaroEvent[] {
    return this.log;
  }
}
