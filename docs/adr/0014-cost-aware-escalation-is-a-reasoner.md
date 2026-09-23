# 0014 — Cost-aware model escalation is a Reasoner, not a new kernel primitive

Status: accepted
Date: 2026-09-24

## Context

The SMB roadmap (see [docs/product/README.md](../product/README.md)) needs a
"try cheap, verify, escalate to a stronger model only on failure" execution
pattern — the mechanism that makes a small model's *effective* reliability
competitive with a frontier model's *raw* reliability on a narrow task,
without training or distillation infrastructure Naro has already declined to
build ([docs/learn/01-training.md](../learn/01-training.md)).

The question this record answers: does that pattern need new kernel
surface — a new `Decision` kind, a new `AgentState`, a new `AgentDeps`
field — or is it expressible entirely with what `@naro/core` and
`@naro/runtime` already provide?

Tracing the existing loop answers it. `AgentRunner` already does most of
this today, for a reason unrelated to cost: a `'complete'` decision is a
claim, not a fact (ADR 0001). When `deps.verifier` is configured, the
runner enters `VERIFYING`; a failed check transitions to `REPLANNING` and
records an observation naming the verifier and the reason
(`runtime/src/runner.ts`, `handle()` → `case 'complete'`). Per-action
decisions go through the same `verifyAll()` path. Nothing about that loop
assumes the *next* attempt uses the same model — that choice is entirely
internal to whichever `Reasoner` is attached. A `Reasoner` that tracks "how
many times has this goal been replanned" (via `ctx.iteration`, or by
scanning `ctx.observations` for `kind: 'verification'` failures) and picks
a cheaper or stronger model accordingly needs no runtime change at all.

## Decision

Cost-aware escalation ships as a `Reasoner` — provisionally
`EscalatingReasoner` in `@naro/reasoning` — that composes two or more
child strategies (each itself a `Reasoner`, typically `ReActReasoner`
instances bound to different `Model`s) behind one `strategy` identity.
Internally it:

1. Delegates to the cheapest configured tier by default.
2. Tracks replan count / verification-failure count from `ctx` alone —
   no new context field.
3. Switches which child strategy handles the next `decide()` call once a
   configurable threshold is crossed (default: any verification failure).
4. Never bypasses `deps.verifier` and never emits its own completion
   claim — it still returns ordinary `Decision`s; the runtime's existing
   `VERIFYING`/`REPLANNING` transitions are what actually gate escalation
   from taking effect.

Which tier produced a given decision is already visible in the journal
without a new event: `model.usage` already carries `usage` per call
(`core/src/reasoner.ts`), and every `ChatResponse.model` names the model
that answered. Cost-per-outcome is a query over existing `model.usage`
events, not a new telemetry primitive — `@naro/evaluation`'s
`computeMetrics` is the natural place for a cost-rollup convenience
function, added later if the raw query proves inconvenient.

## Alternatives considered

- **A new `Decision` kind, `'escalate'`.** Rejected: `Decision` is a
  closed union every reasoning strategy must exhaustively handle
  (`react.ts`, `plan-execute.ts`, `tree-search.ts`, `reflect.ts`, and any
  third-party strategy). Adding a member to it for one strategy's
  internal bookkeeping is disproportionate — escalation is a *reasoner*
  concern, not something every strategy or the runtime needs to know
  exists.
- **A new runtime state, `ROUTING`, or a new `AgentDeps.costRouter`
  field.** Rejected for the same reason ADR 0003 keeps `PolicyEngine`
  as the single authorization seam rather than scattering authority
  checks: adding a parallel kernel concept for something the existing
  `VERIFYING`→`REPLANNING` transition already provides duplicates a
  mechanism instead of reusing it, and every runtime consumer (checkpoint
  serialization, the CLI, the console) would need to learn about it.
- **Silent model-swapping inside a `Model` adapter or `ModelProvider`.**
  Rejected: if the cheap→strong choice happens beneath the `Reasoner`
  layer, the decision to escalate is invisible to the journal — an
  auditor asking "why did this cost more than expected" finds no answer
  in the evidence record. Escalation is itself a decision worth being
  able to explain, so it belongs at the layer that already produces
  observable decisions.
- **A dedicated `Verifier` that also selects the next model.** Rejected:
  conflates two responsibilities the kernel deliberately keeps separate
  — `Verifier` answers "was this correct," not "what should happen
  next." Mixing them would make verifiers strategy-aware, breaking the
  existing composability of `allOf`/`anyOf` verifier combinators.

## Consequences

- No changes to `@naro/core`'s `Decision` union, `AgentState`, or
  `AgentRunner`'s public surface. `EscalatingReasoner` is exactly as
  privileged as `ReActReasoner` — a `Reasoner` implementation, nothing
  more.
- Escalation is journaled for free: each tier's `model.usage` events and
  each `verification.completed` event already show which model answered
  and whether it passed, so `naro verify`/`buildEvidence()` needs no
  changes to make an escalation decision auditable.
- The cost of this choice: `EscalatingReasoner` must itself stay
  strategy-agnostic — it can't assume its children are `ReActReasoner`s
  specifically, only that they satisfy `Reasoner`. That's a real
  constraint on its implementation, not a limitation of the decision.
- `@naro/evaluation`'s `BenchmarkRunner` needs no change to prove this
  works: a benchmark case with an `EscalatingReasoner` and a check on
  `computeMetrics(events)`'s token/usage totals is sufficient to produce
  the cost-per-outcome numbers PRD-001 requires — see
  [docs/product/prd-001-cost-aware-escalation.md](../product/prd-001-cost-aware-escalation.md).
- If a future case genuinely needs the runtime itself to know about
  escalation (for example, a policy rule that denies escalation past a
  cost cap *before* the reasoner even attempts the expensive call), that
  is a new decision, not an extension of this one — `AgentDeps.budgets`
  already exists for hard caps and may be sufficient when that need is
  concrete.
