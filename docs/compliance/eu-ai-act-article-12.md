# EU AI Act Article 12 — mapped to Naro's evidence architecture

*Explanation + reference.* What Article 12 requires of a high-risk AI
system's logging, which of that Naro's existing architecture already
provides, and what is genuinely missing. Written for the buyer
[docs/positioning.md](../positioning.md) already names — "regulated
workloads... a team that must show *why* an agent did something and
*that* the outcome was checked" — not the SMB buyer
[docs/product/README.md](../product/README.md) is scoped to.

This is not legal advice, and it does not claim Naro makes a deployment
compliant on its own — a compliance determination is the deploying
organization's and its counsel's, not this document's. What follows is a
factual mapping between one article's text and this repository's code, so
that determination can be made with evidence instead of a vendor's word.

## Why this article, specifically

**Correction (2026-09-23):** an earlier version of this document stated
the high-risk obligations become enforceable August 2, 2026. That date
has since moved: the Digital Omnibus on AI (Regulation (EU) 2026/1744,
in force from 27 July 2026) deferred standalone high-risk systems
(Annex III — the category an autonomous agent typically falls under) to
**December 2, 2027**, and product-embedded high-risk AI (Annex I) to
August 2, 2028. Article 5's prohibited-practices regime and Article 50's
transparency/labeling duties were *not* deferred and remain in force on
their original schedule. Verify the current date for your specific
classification before treating any date here as authoritative — this
regulation has already moved once.

Article 12 ("Record-keeping") requires high-risk AI systems to be
"designed and developed with capabilities enabling the automatic
recording of events ('logs') over the duration of the system's
lifetime," specifically to:

- enable "identification of situations that may result in the AI system
  presenting a risk... or lead to a substantial modification";
- "facilitate the post-market monitoring... and the monitoring... of the
  operation";
- support **traceability** of the system's functioning throughout its
  lifecycle.

Logs must be tamper-evident and retained for a minimum period set by
sector-specific rules (commonly cited at 6 months, extended to 24 months
for biometric and law-enforcement-adjacent systems — the exact figure is
set by the applicable sectoral legislation, not the Act's general text
alone; verify the figure for your specific use case).

An agent that acts autonomously against real systems is squarely the
kind of component this article was written for. Whether a *given*
deployment counts as "high-risk" under Annex III is a legal
classification this document does not make — what it maps is: if yours
does, here is what Naro's architecture already gives you toward Article
12, and where the gap is.

## What Article 12 asks for, mapped to what exists

| Article 12 requirement | Naro mechanism | Status |
|---|---|---|
| Automatic recording of events, not manual/opt-in logging | Every state transition emits a `NaroEvent` through `EventBus`, enforced by `assertTransition` — there is no code path that changes agent state without emitting one ([docs/principles.md](../principles.md), Observability) | **Implemented** |
| Traceability of the system's functioning, not just its inputs/outputs | `Action` (intent) and `Observation` (evidence) are separate, both journaled — a policy verdict, an execution attempt, and a verifier's judgment are each individually inspectable, not collapsed into one "the agent did X" message ([ADR 0002](../adr/0002-action-and-observation-are-separate.md)) | **Implemented** |
| Identification of risk-relevant events (failures, near-misses, overrides) | Failures are observations with `success: false` and `error`; policy denials, human overrides, and verification failures are their own event types (`action.denied`, `human.approval.answered`, `verification.completed` with a fail outcome) — queryable, not inferred from absence | **Implemented** |
| Tamper-evident logs | Hash chain: every event carries `prev` and `hash` (SHA-256 over the canonical event); `naro verify <run.jsonl>` recomputes the chain and exits non-zero on a break ([ADR 0005](../adr/0005-hash-chain-in-the-event-bus.md)) | **Implemented** |
| A way to prove the log itself wasn't altered after the fact, not merely internally consistent | `journal.sealed`: an Ed25519 signature over the chain head, checked with `naro verify --pubkey` ([docs/positioning.md](../positioning.md) Phase 1) | **Implemented**, with a named trust boundary (below) |
| Retention "over the duration of the system's lifetime" / a minimum period set by sectoral rules | None. `SqliteEventStore`/`PgEventStore` keep every event indefinitely by default; there is no built-in pruning, no configurable minimum-retention guarantee, and no mechanism to prevent early deletion by an operator with database access | **Gap — see below** |
| Post-market monitoring support (aggregate patterns across runs, not just one run's trace) | `computeMetrics(events)` derives per-run behavior; `RunRegistry`/`GET /runs` lists runs across a deployment. Cross-run trend analysis (e.g., "denial rate rising over the last month") is a query an operator writes against the store, not a built-in report | **Partially implemented** — the data is there; the aggregation tooling is not |

## What "tamper-evident" does and doesn't mean here

Article 12 doesn't use the word "tamper-proof," and neither does Naro's
own documentation: [docs/market-quadrant.md](../market-quadrant.md)'s
"Cautions for a buyer" section already states this plainly — "tamper-
evidence is real; tamper-*proof* depends on your key custody (KMS/HSM) —
the seal moves trust, it does not remove it." An auditor asking "could
this log have been altered" gets an honest two-part answer: alteration
of any event breaks the hash chain (detectable, always), and the
Ed25519 seal proves the chain head existed at signing time under
whoever held the key (detectable alteration *after* sealing; trust in
the key's custody is what backs "before sealing," same as any
signature-based scheme).

## The retention gap, specifically

This is the one requirement in the table above with no code behind it
today. Two things are missing, and they're different problems:

1. **A floor** — nothing stops an operator from deleting events before
   the applicable minimum retention period. This is a deployment-
   operational control (database permissions, backup policy), not
   something the kernel can enforce from inside a process an operator
   already has write access to — the same honest boundary
   [docs/production-readiness.md](../production-readiness.md) draws for
   every other operational guarantee.
2. **A ceiling** — nothing prunes events *after* the retention period
   either, which isn't a compliance violation by itself but does mean
   "durable forever" is the only mode today. A deployment with its own
   data-minimization obligations (GDPR storage limitation, alongside the
   AI Act) has no built-in way to prune while keeping the chain — and
   pruning the middle of a hash chain without breaking `naro verify` is
   a real design problem this document does not solve.

[ADR 0018](../adr/0018-attested-retention-pruning.md) (proposed) closes
this: a `naro prune --before <date>` command that removes events but
leaves behind an attested `journal.retention.pruned` marker — recomputing
`naro verify`'s starting point from that marker's disclosed hash rather
than silently accepting a gap or reporting what looks like tampering. It
reuses the hash chain's existing `expectPrev` mechanism and the same
Ed25519 seal primitive Phase 1 already ships, rather than inventing new
cryptography. Proposed, not yet implemented.

## Adjacent: Article 14 (human oversight)

Not this document's primary scope, but one finding from the same
code-reading pass is concrete enough to note here rather than in a
separate document: Article 14 requires oversight personnel have "the
ability to halt the system through a stop button or comparable
procedure." Naro has per-action human oversight today
(`require_approval` policy verdicts gate a *specific future* action) and
bounded budgets (`maxIterations`, `budgets.maxCostUsd`/`maxTotalTokens`
on `AgentDeps`), but no way for an operator to halt an *already-running*
run without shutting down the entire `naro serve` process — confirmed by
reading `cli/src/serve.ts`'s route table: no `POST /runs/:id/cancel`
exists, even though the per-run `AbortController` the drain path already
uses is right there, unexposed. [ADR 0022](../adr/0022-attributed-run-cancellation-endpoint.md)
(proposed) closes this: an attributed, role-gated cancel endpoint reusing
the existing cancellation mechanism, not a new one.

## What this document is not

- Not a claim that any specific Naro deployment is Article 12 compliant
  — compliance depends on the whole system (the model, the actions it's
  granted, human oversight design, risk management documentation) far
  beyond logging.
- Not a claim that Article 12 is the only relevant obligation. High-risk
  systems also carry risk-management, data-governance, transparency, and
  human-oversight requirements this document does not map — those touch
  policy design (`@naro/policy`) and human-approval workflow (`@naro/runtime`'s
  `WAITING_FOR_PERMISSION`) more than the event journal, and would need
  their own mapping.
- Not legal advice. Talk to counsel about whether your system is
  high-risk under Annex III and what your sector's specific retention
  period is before relying on any of the above.

## Related

- [Evidence-gated completion](../concepts/evidence-gated-completion.md) —
  why a run isn't done until the kernel has proof.
- [ADR 0005](../adr/0005-hash-chain-in-the-event-bus.md) — the hash chain.
- [ADR 0018](../adr/0018-attested-retention-pruning.md) — the retention
  mechanism this document names as a gap.
- [ADR 0022](../adr/0022-attributed-run-cancellation-endpoint.md) — the
  Article 14 stop-button gap noted above.
- [Production readiness](../production-readiness.md) — what a deployment
  must still provide beyond the kernel.
- [Market quadrant](../market-quadrant.md) — "Cautions for a buyer" on the
  tamper-evidence/tamper-proof distinction.
