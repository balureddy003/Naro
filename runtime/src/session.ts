import {
  createObservation,
  type Action,
  type ContextItem,
  type NaroEvent,
  type Observation,
  type Task,
} from '@naro/core';

/**
 * Anything that can return a run's journal — `SqliteEventStore`,
 * `PgEventStore`, an in-memory list, a JSONL file parsed elsewhere.
 */
export interface JournalSource {
  history(filter: { runId?: string; agentId?: string }):
    Promise<readonly NaroEvent[]> | readonly NaroEvent[];
}

/** What a journal rebuilds: the same state a checkpoint would restore. */
export interface RecoveredSession {
  /** The run these events belong to. */
  readonly runId: string;
  /** Next sequence number — where the resumed journal continues. */
  readonly seq: number;
  /** Hash-chain head — what the next emitted event links to. */
  readonly head?: string;
  /** Iteration to resume at — redoes an interrupted one (at-least-once). */
  readonly iteration: number;
  readonly tasks: readonly Task[];
  readonly actions: readonly Action[];
  readonly observations: readonly Observation[];
  readonly context: readonly ContextItem[];
  /** Latest compaction marker, if the journal was compacted. */
  readonly compaction?: { readonly upToSeq: number; readonly summary: string };
}

/**
 * Rebuild session state from the journal — the session-as-source-of-truth
 * path that makes checkpoints an optimization rather than a requirement.
 *
 * Recovery rules:
 *  - tasks come from `task.created`, actions from `action.requested`,
 *    observations from `observation.created`, context from
 *    `context.retrieved.items` (absent in pre-Phase-2 journals → empty);
 *  - iteration resumes at the last *interrupted* one: a `reasoning.started`
 *    without a matching `reasoning.completed` means the run stopped
 *    mid-decision, so that iteration replays — the deterministic
 *    idempotency key (`runId:iter-N`) makes the replay safe;
 *  - a `session.compacted` event collapses observations created at or
 *    before `upToSeq` into one synthetic summary observation;
 *  - `seq`/`head` continue from the journal's last event, not from a
 *    checkpoint — the journal is the authority.
 */
export function recoverSession(events: readonly NaroEvent[]): RecoveredSession {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const tasks: Task[] = [];
  const actions: Action[] = [];
  const observations: { seq: number; obs: Observation }[] = [];
  const context: ContextItem[] = [];
  let lastStarted = -1;
  let lastCompleted = -1;
  let compaction: RecoveredSession['compaction'];

  for (const e of sorted) {
    switch (e.type) {
      case 'task.created': tasks.push(e.data.task); break;
      case 'action.requested': actions.push(e.data.action); break;
      case 'observation.created': observations.push({ seq: e.seq, obs: e.data.observation }); break;
      case 'context.retrieved': if (e.data.items) context.push(...e.data.items); break;
      case 'reasoning.started': lastStarted = e.data.iteration; break;
      case 'reasoning.completed': lastCompleted = e.data.iteration; break;
      case 'session.compacted': compaction = e.data; break;
    }
  }

  const recovered: Observation[] = compaction
    ? [
        createObservation({
          source: 'session', kind: 'system', success: true,
          output: `Session compacted at seq ${compaction.upToSeq}:\n${compaction.summary}`,
        }),
        ...observations.filter((o) => o.seq > compaction.upToSeq).map((o) => o.obs),
      ]
    : observations.map((o) => o.obs);

  const last = sorted.at(-1);
  return {
    runId: last?.runId ?? '',
    seq: (last?.seq ?? 0) + 1,
    ...(last?.hash !== undefined && { head: last.hash }),
    // An interrupted iteration (started but never completed) replays.
    iteration: lastStarted > lastCompleted ? lastStarted : lastCompleted + 1,
    tasks, actions, observations: recovered, context,
    ...(compaction !== undefined && { compaction }),
  };
}

/** Resolve a journal argument — array of events or a store — to events. */
export async function readJournal(
  source: JournalSource | readonly NaroEvent[],
  filter: { runId?: string; agentId?: string } = {},
): Promise<readonly NaroEvent[]> {
  // Array.isArray can't narrow `readonly T[]` unions — test the port instead.
  const events = typeof (source as JournalSource).history === 'function'
    ? await (source as JournalSource).history(filter)
    : (source as readonly NaroEvent[]);
  if (filter.runId) return events.filter((e: NaroEvent) => e.runId === filter.runId);
  return events;
}
