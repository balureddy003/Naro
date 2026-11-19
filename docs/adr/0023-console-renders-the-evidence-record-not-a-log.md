# 0023 — The console renders the evidence record, not a separate telemetry pipeline

Status: accepted
Date: 2026-09-23

## Context

`@naro/client` and `naro serve`'s built-in console (`GET /console`) are
already implemented and merged — this record documents a decision
already made in code, not a proposal, the same retroactive shape ADR
0012 used for control-plane identity. It exists because the decision was
never written down and, without it, nothing stopped a later change from
quietly drifting away from it.

Every mainstream agent-observability product (LangSmith, Langfuse, and
the built-in consoles most orchestration frameworks ship) works the same
way: the runtime emits traces/spans to a telemetry pipeline, and a
separate UI queries that pipeline to render what it believes happened.
That pipeline is necessarily a *description* of the run, assembled after
the fact from whatever got exported — it can miss events, reorder them,
or simply disagree with the runtime's own record, and nothing structural
catches the disagreement.

Naro already has something those tools don't: `buildEvidence()`
(`@naro/observability`) — the same function `naro verify` uses to
correlate policy verdict → action → observation → verifier per action
and check it against the hash chain. Building the console as a second,
independent consumer of raw events (the log-tailing pattern) would have
reproduced the correctness problem the hash chain and evidence record
exist to prevent, just one layer up: an evidence-*looking* UI that isn't
provably the evidence.

## Decision

`cli/src/console.ts` calls `client.getEvidence(runId)` —
`@naro/client`'s typed wrapper over `GET /runs/:id/evidence`, which is
`buildEvidence()` run server-side — and renders that record directly.
What the console shows for a given run is not a UI's interpretation of
the journal; it is the same `EvidenceRecord` `naro verify --json` would
print for that run, rendered instead of printed. There is no second code
path that independently reconstructs "what happened" for display
purposes.

`@naro/client` itself is split the way TanStack Query and Zag.js
popularized — `NaroClient` (thin typed HTTP wrappers, no state) plus
headless primitives (`watchRun`, `pollRuns`, `pollApprovals`, each a
callback + unsubscribe, no rendering opinion) — specifically so the
evidence-record-as-source-of-truth property survives being embedded in
someone else's dashboard, not just the one Naro ships. A team building
their own UI on `@naro/client` inherits "what you see is what `naro
verify` would prove," not just "here's a client library."

## Alternatives considered

- **A separate telemetry/analytics store the console queries** (the
  LangSmith/Langfuse pattern). Rejected: this is the exact split ADR
  0005's hash chain and this repo's evidence architecture exist to
  avoid — a UI that could show something other than what the journal
  proves, with no structural link between the two.
- **Render raw events directly, no `buildEvidence()` correlation.**
  Considered for the live event stream (and used there — `watchRun`
  streams raw `NaroEvent`s for the running-in-real-time view) but
  rejected for the evidence/history view specifically: an operator
  reviewing a completed or in-progress run's outcome wants "was this
  action authorized, executed, and verified," which is exactly what
  `buildEvidence()` answers and a flat event list does not, without the
  operator doing the correlation themselves.
- **A general-purpose dashboard framework** (Refine.dev-style, backed by
  a generic REST/GraphQL data provider). Rejected: Naro's console has
  exactly one data shape worth optimizing for — the evidence record —
  and a general CRUD-dashboard framework would add configuration surface
  for a use case (arbitrary resource management) the console doesn't
  have.

## Consequences

- The console cannot show anything `naro verify` disagrees with — by
  construction, not by testing discipline. A future change that adds a
  UI feature by querying something other than `getEvidence()`/`getRun()`/
  `streamEvents()` is reintroducing the exact drift this decision exists
  to prevent, and should be treated as a regression, not a feature.
- This is a real, checkable differentiator, not a DX nicety: verified
  here by reading `cli/src/console.ts` calling `client.getEvidence()`,
  which calls `GET /runs/:id/evidence`, which is `buildEvidence()` —
  three hops, no gap, traceable end to end.
- It is *not* a claim that the console is more mature or full-featured
  than LangSmith/Langfuse/Mastra's dashboards — it plainly isn't (single
  static page, no persistence of view state, no team features). The
  claim is narrower and structural: what it does show is provably
  correct, not merely presented well.
- `docs/market-quadrant.md`'s "Cautions for a buyer" section stated
  "there is no console, no managed control plane, no SLA" — the first
  clause was true when written and is not anymore; corrected in the same
  change as this record, along with adding this property to "Uniqueness."
