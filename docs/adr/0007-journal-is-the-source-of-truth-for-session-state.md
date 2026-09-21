# 0007 — The journal is the source of truth for session state

Status: accepted
Date: 2026-09-29

## Context

Until now a paused or crashed run could only continue from a `Checkpoint` — a
second, parallel record of the run that must be kept in sync with the journal
and can drift from it. Anthropic's *Scaling Managed Agents* argues the durable
event log should be the session itself: brain and hands are disposable, the
log is not.

Naro's journal already records every task, action, observation, retrieval, and
verification. The missing piece was a way to rebuild run state from it.

## Decision

`AgentRunner.wake(source, runId?)` rebuilds a run's session — tasks, actions,
observations, retrieved context, iteration — by replaying the journal
(`recoverSession` in `runtime/src/session.ts`), then continues the run with
the same `runId`, sequence, and hash-chain head. `JournalSource` is any object
with `history(filter)`; `SqliteEventStore` and `PgEventStore` already qualify.

Two contract changes make the journal self-contained:

- `context.retrieved` now carries `items`, not only `itemCount` — a journal
  that cannot reproduce the context it fed the reasoner is not a session.
- `session.compacted` is a new event type: compaction is a kernel operation
  *on* the journal — the summary is itself an event — not a prompt-side
  window. `AgentRunner.compact(summary)` emits it and collapses live
  observations; `recoverSession` applies the same collapse on rebuild.

Iteration recovery is deliberately conservative: a `reasoning.started`
without a matching `reasoning.completed` replays that iteration — the
deterministic idempotency key (`runId:iter-N`) makes the replay safe.
At-least-once, as with checkpoints.

## Alternatives considered

- **Checkpoints remain the only resume path.** Rejected: two sources of truth
  drift; every field added to checkpoints must also be added to the journal
  for audit, and the journal is the one that is hash-chained.
- **A separate session store beside the journal.** Rejected: that *is* the
  journal with extra steps. One ordered log already holds the facts.
- **Compaction that rewrites or truncates the journal.** Rejected: rewriting
  history breaks the hash chain and destroys the audit trail. A compaction
  *event* keeps the full record verifiable while giving rebuilds a summary.
- **Reasoner-side `maxObservations` window as the answer to growth.** Kept as
  a fallback, but it drops evidence rather than summarizing it and leaves the
  journal unchanged — it is a prompt optimization, not session management.

## Consequences

- Checkpoints are now an optimization (fast hydrate), not a requirement; a
  deployment can run with only an event store.
- Events are slightly larger (`context.retrieved` carries items).
- `wake` filters by `spec.id` and refuses an empty journal — a runner never
  silently starts fresh under a resumed identity.
- Journal segments emitted between the last checkpoint and a crash are no
  longer orphaned on resume: wake links to the journal's own head.
- The journal is now the place session semantics live; future session
  features (replication, retention policies, richer compaction) build on
  `recoverSession`, not on new state channels.
