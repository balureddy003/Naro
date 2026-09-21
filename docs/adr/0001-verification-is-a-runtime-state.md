# 0001 — Verification is a state in the agent state machine

Status: accepted
Date: 2026-09-20

## Context

A model that has finished a task says so. Nothing about that sentence is
evidence. Most agent frameworks treat completion as the end of the loop and
offer verification as a hook, a guardrail, or an eval you run afterwards. In
each of those designs the developer must remember to wire the check in, and a
missing check produces a run that looks successful.

Naro's runtime is an explicit state machine (`core/src/state.ts`). The question
was whether "check the claim" belongs *inside* that machine, where it is
enforced by topology, or *around* it, where it is enforced by convention.

## Decision

`VERIFYING` is a state. A `complete` decision does not end the run; it moves the
runner into `VERIFYING`. If a `Verifier` is configured and rejects the evidence,
the runner moves to `REPLANNING`, records an observation naming the verifier
and the reason, and the reasoner sees that observation on its next turn. Only
an accepted claim reaches `COMPLETED`. Per-action verification follows the same
path after `OBSERVING`.

Enforced in `runtime/src/runner.ts` (`handle()` → `case 'complete'`, and
`verifyAll()`); the legal transitions are in `TRANSITIONS`.

## Alternatives considered

- **Post-run hook (`onComplete(result) → boolean`).** Rejected: a hook can be
  omitted, and a rejected result has no path back into the loop — the run is
  already over.
- **Verification inside the reasoner.** Rejected: the component making the
  claim would also be judging it. The runtime owns control; the model proposes.
- **Verification as a tool the model calls.** Rejected: the model decides
  whether to call it. Optional verification is no verification.

## Consequences

- Completion is a claim until a verifier accepts it. Documentation and events
  use that language deliberately.
- `Verifier` is optional on `AgentDeps`; without one, completion is
  *unverified*, and the runtime says so rather than pretending.
- Verification failures are observations with `success: false`, so the
  reasoner can adapt rather than the run dying on an exception.
- The state table must keep `VERIFYING → REPLANNING` and
  `VERIFYING → COMPLETED` as the only success/failure exits; a shortcut from
  `REASONING → COMPLETED` exists only when no verifier is configured.
- This is the differentiator named in [positioning.md](../positioning.md);
  changing it changes what Naro is.
