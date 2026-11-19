# Vision and Roadmap — Closing the Production Gap

*Explanation.* What four independent 2026 industry surveys say is actually
blocking agentic AI from reaching production, how that maps onto Naro's
already-shipped architecture, and the concrete system design and phased plan
that would close the one gap that remains. This is a planning document, not
an ADR — it makes no kernel decision. Where it proposes new surface, it names
the ADR that would need to exist before code lands.

## 1. The research, triangulated

Four independent sources, different methodologies, same conclusion:

| Source | Finding | What it actually measured |
|---|---|---|
| Gartner (Jun 2025 prediction; Apr 2026 Hype Cycle) | 40% of agentic AI projects will be canceled by 2027; only ~130 of thousands of self-described "agentic" vendors have genuinely agentic features; the 2026 Hype Cycle found only ~17% of organizations had actually deployed an agent | Vendor claims vs. deployed reality, surveyed vendor base |
| McKinsey, *State of AI in 2026* | ~90% use AI somewhere; only 44% are "scaling" it; large companies scaling agents rose 27%→40% but small orgs stayed flat at 22%; only 37% attribute *any* EBIT impact to AI; only ~6% are "high performers" (≥5% EBIT impact, judged significant) — unchanged from 2025; ~20% say cost constrains further use | 1,719 respondents, 97 countries, May–Jun 2026 |
| McKinsey, *AI Trust Maturity Survey* (2026, reported secondhand — primary text not independently confirmed here) | ~2/3 of organizations are experimenting with agents; fewer than 1/4 have scaled to production; ~1/3 have governance maturity adequate for what they've already deployed; agentic controls are reportedly the lowest-scoring governance dimension tracked | ~500 organizations |
| MIT / Project NANDA, *The GenAI Divide* | ~95% of enterprise GenAI pilots show no measurable P&L impact; only ~5% reach production | 52 interviews + analysis of 300+ public initiatives (contested methodology per critics — directional, not precise) |
| Deloitte 2026 (reported secondhand) | 80% of leaders piloting agents cite security/compliance as the leading obstacle to scaling | Survey of enterprise AI leaders |

Four different lenses — vendor-claim audits, EBIT attribution, governance
maturity scoring, and P&L impact interviews — land in the same place:
**somewhere between 5% and 25% of agentic efforts reach real production
value, and the obstacle named most often is not model capability. It's
trust: can the organization show what the agent did, and that someone
checked it.** This is consistent with the RegTech-specific data already in
[docs/market-quadrant.md](market-quadrant.md): RegTech has 88% pilot/funding
adoption but only 33% production conversion — the gap is attributed
specifically to audit-trail completeness requirements, not accuracy.

None of these reports should be read as precise instruments — the MIT
figure in particular is contested, and the AI Trust Maturity Survey numbers
above aren't independently confirmed against McKinsey's own primary text.
Treat the *direction* as solid (triangulated across four unrelated
methodologies) and the specific percentages as directional, not exact.

## 2. What this actually requires of a system

Translating "governance maturity is the blocker" into concrete, buildable
requirements — the bar for being in the ~17–25% that scales, not the
~75–95% that doesn't:

1. A policy gate every action passes through structurally — not a
   convention a developer remembers to call.
2. A tamper-evident record correlating policy verdict → action →
   observation → verification outcome, per action — not a freeform log a
   human has to reconstruct a timeline from.
3. Attributed human approval for irreversible actions, with the approver's
   identity in that same record.
4. Completion that is *checked*, not asserted — the model's claim that it's
   done is a claim, not evidence.
5. Cost predictability — ~20% of McKinsey's respondents name cost as a
   binding constraint, and a small organization can't absorb a surprise
   bill the way an enterprise can.
6. A real, provable production outcome for a real counterparty — this is
   the actual 5%/17%/25% line. A demo, a fixture benchmark, or an internal
   pilot does not cross it; a stranger trusting the result with their own
   business does.

## 3. Where Naro already stands against each requirement

This is not a wishlist exercise — every claim below is checked against the
current tree (`git log` at `23561f9` plus this branch's merge), not against
documentation alone. Build is green, 566 tests pass, 0 npm audit findings
as of this document.

| Requirement | Naro today | Evidence |
|---|---|---|
| 1. Structural policy gate | **Shipped.** `AgentRunner.policy` is required — there is no code path that executes an action without a verdict. | [ADR 0003](adr/0003-policy-engine-is-required.md), `RulePolicyEngine`, `createToolPolicy` |
| 2. Correlated tamper-evident record | **Shipped, and stronger than the baseline ask.** Every event is SHA-256 hash-chained (`prev`/`hash`); `naro verify` recomputes the chain independently of the writer. `buildEvidence()` joins policy verdict → action → observation → verifier verdict per action. Optional Ed25519 seal makes the chain tamper-evident *with attribution*, not just tamper-evident. | [ADR 0005](adr/0005-hash-chain-in-the-event-bus.md), `production-readiness.md` §5 |
| 3. Attributed human approval | **Shipped**, both single-host (`SqliteApprovalBridge`) and multi-host (`PgApprovalBridge`). `human.approval.received` carries the approver's control-plane identity (`by`). | ADR 0012, `adapters/postgres/src/stores.ts` |
| 4. Verified completion, not asserted | **Shipped, and the single clearest architectural differentiator.** `VERIFYING` is a state in the runtime's own state machine (ADR 0001) — not a wrapper, not an opt-in callback. A `complete` claim that fails verification forces `REPLANNING`. No competitor named in [docs/positioning.md](positioning.md) (LangGraph, CrewAI, Mastra, agent-kernel, Bastion, Claude Agent SDK) makes verification a runtime state. | [ADR 0001](adr/0001-verification-is-a-runtime-state.md) |
| 5. Cost predictability | **Substantially shipped, under-labeled.** `EscalatingReasoner` (cost-aware tiering) has real code and tests in `reasoning/src/escalating.ts`; PRD-005 has a *verified* result (qwen2.5:3b against a live Ollama instance, all five required capabilities confirmed) — this is further along than "proposed" status suggests, though per the product README that status deliberately tracks *ship-date commitment*, not code existence, so it is not a documentation bug. | `reasoning/src/escalating.test.ts`, commit `e9f8471` |
| 6. A real production outcome for a real counterparty | **The one gap.** `@naro/templates` ships `transaction-categorizer` and `invoice-extractor`, each with a real verifier (category-membership / schema + arithmetic reconciliation) and real benchmark numbers against fixtures and historical data (commits `db666cb`, `caae4a1`, `ca292c5`). `examples/chat-demo` already wires these templates to a `/chat` endpoint. **No template has yet processed one real external user's real data.** This is explicitly flagged as an open risk in PRD-002 itself ("verifier quality is the whole product... needs real-data validation... before calling a template 'shipped'"). | `templates/src/*`, `examples/chat-demo` |

The honest read: **Naro's kernel already answers the dominant blocker named
by Gartner, McKinsey, MIT, and Deloitte better than the frameworks
currently winning deals** — none of LangGraph, CrewAI, Mastra, or the
pure-governance kernels (agent-kernel, Bastion, Weaver) make verification a
runtime state the way ADR 0001 does. The system design problem is not "add
more kernel capability." It's "cross the line that 75–95% of the market
never crosses" — and the two templates needed to attempt that crossing are
already built and already benchmarked. They have just never touched a real
stranger's real invoices.

## 4. System design to close the remaining gap

The design principle: **do not build a product. Build the thinnest
possible real-world intake path for a template that already works**, and
make the kernel's own evidence record the trust artifact handed back to
that first real user — turning a developer-facing `naro verify` output into
something a bookkeeper can actually read and believe.

### 4.1 Intake adapter (new, small)

A single new adapter — not a new package category, fits the existing
`adapters/*` extension point per architecture.md §15 — that watches one
narrow intake surface (a shared folder or a dedicated inbox address) and
turns each new file into a `Goal` against the `invoice-extractor` template.
Recommended template: **invoice-extractor over transaction-categorizer**,
because its verifier (schema validity + line-items-sum-to-total) is
objectively explainable to a non-technical buyer in one sentence, where
category-correctness against a chart of accounts requires the buyer to
trust a judgment call.

This needs no new kernel primitive — `Environment.execute()` and the
existing template composition (`{goal template, tools, verifier, cost
budget, reasoner tier}` per `docs/use-cases.md`) already cover it. If it
needs a new `ActionExecutor` for the intake-surface-specific I/O (reading a
mailbox, watching a folder), that's a normal adapter, not an ADR.

### 4.2 Route uncertainty through the approval bridge, not back to the model

For any extraction below a confidence threshold, the existing
`SqliteApprovalBridge` (or `PgApprovalBridge` for a multi-host deploy)
already does exactly what's needed: hold the action, let a human confirm or
correct it, journal `human.approval.received` with the approver's identity.
This is not new work — it's using what ADR 0012 and the bridge already
provide, pointed at a real low-confidence case instead of a test fixture.

### 4.3 The evidence record is the deliverable, not a debug artifact

`buildEvidence()` and `naro verify` already produce exactly the object a
skeptical first user needs: proof of which policy ran, what the agent did,
what it checked, and whether a human had to step in. The only new work is
presentation — rendering that record as a one-page, plain-language receipt
("here's what was extracted, here's the arithmetic check that passed, here's
who approved the one line we weren't sure about") rather than the
JSON `naro verify --json` emits today. This is a thin view over data the
kernel already produces with full integrity guarantees; it should not grow
into a second telemetry pipeline (ADR 0023's rule against exactly that
applies here too).

### 4.4 Feed the real run back into the benchmark

PRD-002's own open risk — "a category-membership check only proves the
answer is in the allowed set, not that it's the *right* category... needs
real-data validation... before calling a template 'shipped'" — is answered
directly by comparing the real-world run's approval rate and error rate
against the existing fixture/historical benchmark numbers from milestones
1–3. This closes a risk the roadmap already named, with evidence instead of
more fixture data.

## 5. Phased roadmap

Each phase has a concrete exit criterion, not a vibe. Phases are
sequential; nothing here commits a ship date or owner — per the product
docs' own convention, this becomes a PRD with a date once someone picks it
up.

| Phase | Work | Exit criterion |
|---|---|---|
| **0 — now** | None of the documentation needs correcting (checked in §3 above — "proposed" is a deliberate status, not drift). Nothing to fix here; this phase is a checkpoint, not a task. | — |
| **1 — intake adapter** | Build the folder/inbox-watching adapter from §4.1 against `invoice-extractor`; wire low-confidence cases to the existing approval bridge (§4.2). | A synthetic end-to-end run — a dropped invoice file produces a completed run, an evidence record, and (for an intentionally low-confidence fixture) a routed approval — with no new kernel code, only adapter code. |
| **2 — the receipt view** | Render `buildEvidence()` as the plain-language one-pager from §4.3. | A non-technical reader (not you) can look at the output and correctly state what the agent did and what was checked, without explanation. |
| **3 — one real counterparty** | Find one real small business, bookkeeper, or freelancer willing to let the adapter touch real invoices. Run it. Do not simulate this step. | A real run, on real data, outside your own control of the input — plus the honest outcome, success or failure, documented with root cause either way. |
| **4 — close the loop** | Compare real-world error/approval rates against the PRD-002 fixture benchmarks; decide, with evidence, whether the categorizer or a second counterparty is next. | PRD-002's own flagged risk ("verifier quality is the whole product") is answered with real numbers, not closed by assertion. |

Phase 3 is the one that matters most and the one nothing above can
substitute for. A phase-1/2 build without phase 3 is exactly the pattern
Gartner, McKinsey, MIT, and Deloitte all independently describe as the
majority outcome — polished internally, never exposed to someone who could
actually disprove it.

## 6. What this is for

This roadmap does not argue Naro should become a hosted SMB product (that
remains PRD-003's proposal, unchanged by anything here) or that the kernel
needs new capability. It argues the opposite: the kernel already clears the
bar every 2026 industry report says most agentic efforts fail on, and the
templates needed to prove that in the real world already exist and are
already benchmarked. The gap is not architectural. It's that no one has yet
pointed the already-built thing at a real stranger's real problem. Phase 3
is that step, and it is the only phase in this document that cannot be done
by writing more code.

## Related

- [Positioning](positioning.md) — the kernel-level claim this roadmap
  builds on, and what is/isn't a differentiator.
- [Market quadrant](market-quadrant.md) — the RegTech audit-trail finding
  this document's §1 extends with McKinsey/MIT/Deloitte corroboration.
- [docs/product/README.md](product/README.md) and
  [PRD-002](product/prd-002-outcome-templates.md) — the templates this
  roadmap's phases 1–4 are built on top of, unmodified.
- [Production readiness](production-readiness.md) — what the deployment
  in §4.1's intake adapter still has to provide on its own (isolation,
  secrets, backup) beyond what the kernel guarantees.
