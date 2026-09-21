# 0004 — Checkpoints are taken only at reasoning boundaries

Status: accepted
Date: 2026-09-20

## Context

A durable agent must survive a process crash. The naive design snapshots state
as often as possible. The problem is side effects: a snapshot taken *during*
an action captures "I am about to write this file" or "I have sent this
request but not received the reply", and a restore from that snapshot either
repeats the side effect or loses it.

## Decision

`AgentRunner` saves a checkpoint once per loop iteration, after the decision
has been fully handled and before the next `reasoner.decide()`. A checkpoint
contains tasks, actions, observations, context items, iteration, optional
reasoner state, `runId`, the next event `seq`, and the journal chain head. A
resumed runner restores that data, enters `RECOVERING`, and proceeds to
`REASONING`. It never resumes inside `ACTING`.

Each action carries a deterministic `idempotencyKey`
(`${runId}:iter-${iteration}`) so that if the process dies *between* a side
effect and the checkpoint that would have recorded it, the reissued action has
the same identity and an idempotent executor can recognize it.

Enforced in `saveCheckpoint()` and `resumeFromCheckpoint()` in
`runtime/src/runner.ts`.

## Alternatives considered

- **Checkpoint on every event.** Rejected: mid-action snapshots are ambiguous
  about external state.
- **Two-phase commit around every action.** Rejected: most executors (shell,
  HTTP, browser) cannot participate in a transaction; the cost would be paid
  everywhere for a guarantee that holds nowhere.
- **Journal replay as the resume mechanism.** Deferred, not rejected: it is
  Phase 2 of the roadmap. Checkpoints are the current mechanism; a journal
  rebuild would make them an optimization.

## Consequences

- Recovery semantics are at-least-once. The production checklist requires
  idempotent tools or externally recorded operation ids for anything that
  must not repeat.
- `Tool.idempotent` exists so retry policies know what is safe to reissue.
- A checkpoint is never taken in a stopped state, and `PAUSED` is a
  checkpoint-then-return.
- Because the chain head is checkpointed, a resumed run's journal links to the
  previous run's last event; the two halves verify as one chain.
