# 0021 — OTLP span mapping using the GenAI semantic conventions

Status: accepted
Date: 2026-09-23

## Context

`@naro/adapter-otel` exports every `NaroEvent` as an OTLP *log* record,
deliberately not a span: its own source comment states why — "events are
facts in sequence, not a trace tree. Mapping them into spans would invent
parentage the stream doesn't carry. When events gain span/timing
structure, a span mapping can be added honestly." That was true when
written. It no longer is:

- `NaroEvent.traceId` (`core/src/events.ts`) now correlates a whole
  delegation tree — "a root run's `traceId` equals its own `runId`; a
  delegated child run inherits the parent's `traceId`." This is exactly
  what an OTLP trace's `trace_id` needs.
- Every event carries `at` (a timestamp) and `agentId`/`goalId`/`runId`;
  `action.requested` and `action.completed` share `action.id`, so a
  per-action span's start/end is a direct pairing, not an invention —
  `buildEvidence()` already performs the equivalent correlation for
  the evidence record, just without retaining `at` in its output.
- The OpenTelemetry GenAI Semantic Conventions (CNCF, backed by the
  GenAI SIG since 2024) reached a de facto adoption point in 2026 —
  v1.41 defines agent, workflow, tool, and model spans with `gen_ai.*`
  attributes, adopted by Google Cloud, AWS, Azure, Datadog, Honeycomb,
  and Grafana. Naro's own market-quadrant.md scores "ecosystem &
  integrations" as its weakest execution criterion; exporting the
  schema every major observability backend already renders natively,
  instead of a proprietary log shape, is a direct, low-risk close of
  that gap — this is standards adoption, not a differentiator, and
  should not be framed as one.

The parentage the original comment worried about inventing is real now,
not assumed: `traceId` groups a delegation tree, `runId`/`agentId`
distinguishes agents within it, and `action.id` pairs bound each action
span. What is *not* fully resolved is reasoning-iteration nesting within
an agent (whether each `reasoning.started`→`reasoning.completed` pair
should be its own child span of the agent span, or folded into it) —
this decision addresses that explicitly rather than leaving it
ambiguous.

## Decision

`@naro/adapter-otel` gains a second export mode, span-based, alongside
(not replacing) the existing log-record export — a deployment picks one
or both:

1. **Trace** = `traceId` (falls back to `runId` for events with no
   delegation, per the existing default).
2. **Agent span** = one span per `runId`, named `gen_ai.agent`, from
   `goal.started`/`agent.created` to the terminal event
   (`agent.completed`/`failed`/`cancelled`/`paused`) — `gen_ai.agent.name`
   from the goal, `gen_ai.usage.*` attributes from the terminal event's
   `usage`, `error.type` set on failure per the conventions' error
   handling.
3. **Action spans** = one child span per `action.id`, from
   `action.requested` to `action.completed` (or `action.denied`, which
   ends the span immediately with an error status rather than waiting
   for a completion that will never come) — `gen_ai.tool.name` from
   `action.capability`, `gen_ai.tool.call.result` from the paired
   observation's `success`, policy verdict and verifier outcome as span
   attributes (not separate spans — they are facts about the action, not
   independent operations with their own duration).
4. **Reasoning-iteration spans** are explicitly *not* emitted as a third
   span level in v1 — folded into the parent agent span as events
   (OTLP span events, not separate spans) attached at each
   `reasoning.started`/`model.usage` pair. Rationale in Alternatives.
5. Delegated child runs (`traceId` inherited from a parent) produce their
   own agent span, correctly nested under the same trace as the parent's
   action span that triggered the delegation — `@naro/multiagent`'s
   `traceId` propagation is what makes this correct instead of guessed.

## Alternatives considered

- **A third span level for reasoning iterations.** Rejected for v1:
  worth revisiting once real usage shows operators want per-iteration
  latency breakdown, but a span per LLM call inside every action would
  multiply span volume substantially for a benefit (iteration-level
  timing) already partially visible via `model.usage`'s per-call
  `usage` attached as span events. Starting conservative and adding a
  span level later is reversible; starting verbose and asking operators
  to filter it back out is not.
- **Replace the log export entirely.** Rejected: some backends and some
  operator workflows (grep-and-tail style debugging, `naro verify`'s own
  `--json` consumers) want the flat, ordered fact stream the log export
  already provides correctly. Both modes are honest representations of
  the same journal for different consumption patterns — neither is
  wrong, so neither is removed.
- **Derive spans from `EvidenceRecord` instead of the raw `NaroEvent[]`
  stream.** Rejected: `buildEvidence()` is deliberately post-hoc,
  whole-run analysis (built for `naro verify`, run after a run
  terminates); a span exporter needs to emit spans as a run progresses,
  live, the same way the log exporter already does via `pipeTo`. Reusing
  `EvidenceRecord`'s correlation *logic* (the action-id pairing pattern)
  is reasonable; depending on the whole-run record as a hard dependency
  is not.
- **Invent synthetic parent spans for actions with no clean pairing**
  (e.g., a denied action with no `action.completed`). Rejected as a
  silent default: handled explicitly in the Decision (ends immediately,
  error status) rather than left as an edge case the exporter discovers
  by accident.

## Consequences

- Closes a named, current gap (market-quadrant.md's "ecosystem 3/5")
  using a standard the industry is converging on, at the cost of the
  adapter now maintaining two export shapes instead of one — a
  deployment must pick which it wants per its own backend's strengths
  (a log-native backend still gets full fidelity from the existing
  export; a trace-native one gets genuinely useful spans instead of
  flattened logs it would otherwise have to reconstruct itself).
- The GenAI semantic conventions remain pre-1.0/experimental as of this
  writing — `@naro/adapter-otel`'s README should say so plainly and pin
  the convention version it targets, consistent with
  [docs/documentation-style.md](../documentation-style.md)'s "no
  marketing adjectives without evidence": this is "implements the
  current draft," not "implements the standard."
- A denied action ending its span immediately (rather than waiting for
  an observation that will never arrive) means span duration for denied
  actions reflects gate latency only — correct, but worth calling out in
  the adapter's docs so a reader doesn't misread it as execution time.
- No change to `@naro/core`'s event schema or the hash-chained journal —
  this is purely an additional consumer of the existing stream, same
  proportionality as every other adapter in this codebase.
