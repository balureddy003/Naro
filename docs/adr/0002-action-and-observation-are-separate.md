# 0002 — Intent (`Action`) and evidence (`Observation`) are separate records

Status: accepted
Date: 2026-09-20

## Context

Chat-shaped frameworks model everything as messages: the model's tool call is
a message, the tool's result is a message, and a failure is a message with an
error string in it. That shape is convenient for a transcript and useless for
an audit. From a message list you cannot tell, without parsing prose, whether
an action was authorized, whether it ran, or whether the result was checked.

## Decision

Naro records two distinct facts. An `Action` (`core/src/action.ts`) is what the
agent *intended*: capability, target, input, and a lifecycle state
(`requested → authorized | denied → running → completed | failed`). An
`Observation` (`core/src/observation.ts`) is what *happened*: source, kind,
`success`, `output` or `error`, and the `actionId` it answers. A policy denial,
a refused approval, a thrown tool, and a failed verification are all
observations with `success: false`. The reasoner is shown observations, never
raw exceptions.

## Alternatives considered

- **Messages only.** Rejected: audit, policy, and verification all need to
  address "the action" as a thing with identity and state.
- **Action with an embedded result field.** Rejected: one action can yield
  several observations (a policy denial and later a retry; an execution result
  and a verification verdict), and an observation can exist with no action
  (a human answer, a verifier's rejection of a completion claim).
- **Exceptions for failures.** Rejected: an exception ends the loop. A failure
  the reasoner can see is a failure it can route around.

## Consequences

- `ReasoningContext` carries `actions` and `observations` as parallel arrays;
  reasoners join them by `actionId` when rendering a transcript
  (`reasoning/src/transcript.ts`).
- Provider tool-call ids ride on `Action.toolCallId` so the pairing survives
  checkpoint and resume.
- The evidence record (`observability/src/evidence.ts`) is a join over these two
  record types plus the policy and verification events; it exists because the
  separation exists.
- Every new failure path must produce an observation, not a throw across the
  executor boundary. Reviewers check this.
