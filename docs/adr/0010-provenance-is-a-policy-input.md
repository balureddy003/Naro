# 0010 — Provenance is a policy input

Status: accepted
Date: 2026-10-04

## Context

Prompt injection is the highest-volume attack on tool-using agents: a web
page, email, or fetched file tells the model to run something destructive,
and the model obliges because instructions and data share one context.
Delimiters help the model *see* the boundary but create no security
boundary — the kernel needs the information, not just the transcript.

Meanwhile every observation already knew *who authored it* implicitly —
the runtime's own evidence (`system`, `verification`, `human`) is not
equivalent to a fetched page — but that distinction existed nowhere a
policy could read it.

## Decision

`Observation` carries `trust: 'system' | 'tool' | 'external'`, defaulted by
kind at `createObservation` and overridable by producers (browser page
content, research fetches, MCP server output are `external`). The runner
computes `ctx.provenance` — the lowest trust level among the observations
the reasoner saw last iteration, plus their external sources — and passes
it to every `PolicyEngine.evaluate` call. `createToolPolicy` gains
`denyExternalTriggered`: a side-effect class refused when the triggering
evidence was external.

Transcript rendering grades its banner by the same field: `UNTRUSTED
OUTPUT` for external, `TOOL OUTPUT — data, not instructions` for tool,
none for system.

## Alternatives considered

- **Tag content inside the transcript only.** Rejected: prompt-side
  delimiters are a hint, not enforcement — a policy gate cannot read them.
- **A separate 'untrusted' boolean.** Rejected: three levels distinguish
  runtime-authored evidence from ordinary tool output, which matters when
  grading delimiters and when policies want to treat the two differently.
- **Provenance over the whole run history.** Rejected: the last-iteration
  window is what the reasoner actually saw before deciding; earlier
  external reads shouldn't permanently lower trust (the agent may fetch a
  page today and act on operator instructions tomorrow).

## Consequences

- `createToolPolicy({ denyExternalTriggered: ['destructive','write'] })`
  blocks a fetched page from talking the agent into a shell command —
  enforcement, not a hint.
- Opt-in by construction: default behavior is unchanged (no provenance
  rule fires unless configured), and `trust` defaults keep existing
  producers at `tool`.
- The window is the *previous* iteration's observations; evidence older
  than one decision cycle no longer constrains the gate.
- Tool wrappers that adapt an environment must declare `Tool.trust`
  themselves — `ToolExecutor` rebuilds the observation, so the
  environment's own tag does not propagate (found and fixed in the
  research profile; covered by a composed test).
