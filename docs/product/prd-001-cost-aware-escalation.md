# PRD-001 — Cost-Aware Escalation Reasoner

Status: proposed
Owner: unassigned
Depends on: [ADR 0014](../adr/0014-cost-aware-escalation-is-a-reasoner.md)
Depended on by: [PRD-002](prd-002-outcome-templates.md)

## Summary

A `Reasoner` that attempts a task with a cheap model first, verifies the
result through the runtime's existing `VERIFYING` state, and escalates to
a stronger model only when verification fails — so a business pays
frontier prices for the fraction of requests that genuinely need it, not
the whole distribution, without any training or fine-tuning step.

## Problem

Every general-purpose agent product defaults to one model tier for every
request. That is correct for a product that must handle arbitrary,
unbounded tasks well. It is the wrong default for a small business running
a narrow, repeated task (classify this transaction, extract these five
fields, draft this reply) where most requests are easy and a fixed
percentage are hard. Paying frontier-model prices for the easy 90% to
correctly handle the hard 10% is the single biggest reason AI cost is
unpredictable for a small business (see [docs/product/README.md](README.md)).

## Goals

- Cut the fraction of requests that reach an expensive model to only those
  that fail verification on a cheap model, measured, not assumed.
- Make the escalation decision itself observable in the evidence journal
  — an operator can see which tier handled a given action and why it
  escalated, using tools that already exist (`naro verify`,
  `GET /runs/:id/evidence`).
- Ship as an ordinary `@naro/reasoning` strategy. A user who does not want
  escalation uses `ReActReasoner` exactly as before; nothing about
  existing behavior changes.

## Non-goals

- Training, fine-tuning, or distilling any model. Escalation compensates
  for a cheap model's gaps at inference time; it does not close them.
- Picking the "best" model automatically from a leaderboard. The tiers
  are configured by whoever wires up the agent, the same way any
  `Model`/`ModelProvider` is configured today.
- A generic multi-armed-bandit optimizer that learns routing weights over
  time. That is a plausible Phase 5+ capability once there is production
  trace volume; this PRD is inference-time-only.

## Users and scenario

**Primary user:** a developer at (or working for) a small business,
wiring up an outcome template (PRD-002) for a specific task.

**Scenario:** "Classify this bank transaction into one of twelve
categories." Most transactions are unambiguous (a recognized vendor
name, a recurring amount) and a small model gets them right on the first
try. A handful are genuinely ambiguous (a new vendor, a split
transaction) and need a stronger model's judgment. The developer
configures one `EscalatingReasoner` with a cheap tier and a strong tier
and a category-membership verifier; they do not write per-transaction
routing logic.

## Functional requirements

1. **Composition, not a new interface.** `EscalatingReasoner implements
   Reasoner` (`@naro/reasoning`), constructed from an ordered list of
   `{ reasoner: Reasoner; label: string }` tiers (cheapest first) plus an
   escalation policy. It delegates `decide(ctx)` to the currently active
   tier.
2. **Escalation trigger is verification failure, by default.**
   `EscalatingReasoner` inspects `ctx.observations` for verifier failures
   attributable to the current goal/action (the same shape
   `buildEvidence()` already reads) and switches to the next tier after a
   configurable failure count (default: 1). No new context field is
   required — see ADR 0014.
3. **Escalation is one-directional per run by default.** Once escalated,
   later decisions in the same run stay on the stronger tier unless the
   caller opts into de-escalation (out of scope for v1 — start
   conservative).
4. **Every tier's identity is journaled for free.** Each `Decision`'s
   `usage` and each `ChatResponse.model` already carry which model
   answered (`core/src/reasoner.ts`); `EscalatingReasoner` must not
   suppress or rewrite this. No new event type.
5. **Works with any `Reasoner` as a tier**, not only `ReActReasoner` —
   the wrapped strategies are opaque to `EscalatingReasoner`.
6. **Optional low-confidence trigger.** If the underlying model/adapter
   exposes a confidence-like signal (not all do), escalation may also
   trigger below a configured threshold, in addition to verification
   failure. This must degrade cleanly to verification-only when no such
   signal exists — never block on it.

## Success metrics

Measured with `@naro/evaluation`'s `BenchmarkRunner` against a real
outcome template (PRD-002), not simulated:

| Metric | Target for v1 acceptance |
|---|---|
| % of requests resolved without escalating | reported, no fixed target — this is the number the template's real difficulty determines |
| Cost per resolved outcome vs. always-frontier baseline | strictly lower, on the same benchmark suite |
| Task success rate (post-verification) vs. always-frontier baseline | no statistically significant regression |
| P95 latency vs. always-frontier baseline | may be higher (retries cost time) — must be disclosed, not hidden |

A benchmark case with `EscalatingReasoner` plus a check on
`computeMetrics(events)`'s usage totals is the acceptance test — see ADR
0014's consequences.

## Dependencies

- `@naro/reasoning`, `@naro/core` (`Decision`, `ReasoningContext`),
  `@naro/model` (`Model`, `ModelCapability`) — no new package dependency.
- A `Verifier` appropriate to the task — this PRD does not create
  verifiers, it relies on `@naro/verification`'s existing kinds
  (`SchemaVerifier`, `PredicateVerifier`, etc.) or a task-specific one.
- `@naro/evaluation`'s `BenchmarkRunner`/`computeMetrics` for the
  acceptance benchmark.

## Risks and open questions

- **Verification cost itself isn't free.** A verifier that's a second
  model call has its own cost; the net savings claim must account for it
  in the benchmark, not just count escalations avoided.
- **A verifier that's too strict inflates escalation rate and defeats the
  point; too loose lets bad cheap-tier answers through unescalated.**
  Verifier quality is the actual lever here — this PRD does not solve
  verifier design, it assumes a reasonable one exists per template.
  PRD-002 owns picking real verifiers per template.
- **Does escalation need to be visible to the end business owner**, or is
  it purely an internal cost-control mechanism? Leaning toward: surfaced
  in the console's evidence tree (already renders per-action policy
  verdicts; escalation is a natural additional badge), not a
  customer-facing concept. Needs a product decision before PRD-002 locks
  its UI requirements.
- **Multi-tier (3+) vs. two-tier.** The model ladder in the original
  vision sketch (270M → 1B → 3B → 7B → 14B → 32B → frontier) implies
  more than two tiers eventually. v1 should support an arbitrary ordered
  list per the functional requirements above, but the acceptance
  benchmark only needs to prove two tiers work before adding more.

## Milestones

1. `EscalatingReasoner` implementation + unit tests (offline, `MockModel`
   tiers, deterministic escalation triggers) — no real provider needed to
   prove the mechanism.
2. One real benchmark case against a real task (coordinate with
   PRD-002's first template) using real provider adapters, to produce
   real cost numbers — not illustrative ones.
3. Console/evidence-tree surfacing of which tier handled each action
   (small addition to the existing evidence card rendering).
