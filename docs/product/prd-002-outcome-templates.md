# PRD-002 — SMB Outcome Templates Library

Status: proposed
Owner: unassigned
Depends on: [PRD-001](prd-001-cost-aware-escalation.md)
Depended on by: [PRD-003](prd-003-managed-control-plane.md), [PRD-004](prd-004-smb-integrations.md)

## Summary

A small library of pre-built, pre-verified `Goal` + tools + verifier +
cost-budget bundles for tasks a small business actually has — not a
kernel a developer has to assemble from scratch. Each template ships with
its own verifier so "trustworthy by default" is not something the
business has to configure.

## Problem

Naro's kernel is a runtime to build on ([docs/market-quadrant.md](../market-quadrant.md)
already says this plainly: "a kernel to build on, not a hosted
platform"). A small business cannot build on it — there is no one on
staff who knows what a `Reasoner`, `PolicyEngine`, or `ActionExecutor` is,
and there does not need to be. The gap between "a capable runtime exists"
and "a small business owner gets value from it" is exactly what a
template closes: point it at your data, get a working, verified
automation, without writing agent code.

## Goals

- Ship 3–5 templates covering the highest-value, lowest-risk SMB tasks
  (list below), each demonstrably cheaper and no less reliable than a
  frontier-model-only implementation, using PRD-001's escalation reasoner.
- Each template's verifier is not optional or bolted on — it is the
  template. A template without a real verifier does not ship.
- A developer (ours, or eventually a partner's) can stand up a new
  template in the same shape as the first five, without inventing a new
  pattern each time.

## Non-goals

- A no-code builder for business owners to create their own templates.
  That is a plausible later product; v1 templates are built and
  maintained by whoever owns this roadmap, not end users.
- Covering every SMB task. Five templates, chosen for how common and how
  verifiable they are — not an attempt at completeness.
- Vertical-specific customization UI. A template is configured (which
  categories, which tone, which thresholds), not visually redesigned, in
  v1.

## Candidate templates (v1 scope: pick 2 for first ship, remainder follow)

| Template | Business outcome | Verifier shape |
|---|---|---|
| Transaction categorizer | Categorize a bank/card transaction into a fixed chart-of-accounts list | Predicate: category is in the allowed set; optional secondary-model cross-check for low-confidence cases |
| Invoice/receipt extractor | Pull vendor, date, line items, total from a scanned document | Schema validation (`SchemaVerifier`) + arithmetic check (line items sum to total) |
| Customer email draft-reply | Draft a reply to an inbound customer email for human send-approval | Human approval is the verifier (`require_approval` policy decision) — never auto-sent in v1 |
| Review response drafter | Draft a reply to an online review for human approval | Same as above — human approval, not auto-post |
| Appointment scheduling assistant | Propose a reschedule time from an email thread, confirm with the customer | Business rule: proposed time is within business hours and doesn't double-book (checked against calendar data) |

**Recommended first two:** the transaction categorizer and the
invoice/receipt extractor. Both have objective, automatable verifiers
(no human in the loop required for the common case), which makes them the
cleanest place to prove PRD-001's cost claim with a real benchmark before
building anything that touches customer-facing text.

## Functional requirements

1. **Every template is `{goal template, tool set, verifier, cost budget,
   EscalatingReasoner tier config}`** — the same eight-part composition
   [docs/use-cases.md](../use-cases.md) already asks every Naro
   application to define, packaged once instead of asked of the business.
2. **No template auto-executes an irreversible action without human
   approval**, full stop. Draft-and-approve, not draft-and-send, for
   anything customer-facing, in v1. This is not a v2 relaxation to plan
   around — it is the trust posture the whole SMB pitch depends on.
3. **Each template declares its own default cost budget and success
   threshold** (mirroring the `outcome:` contract shape from the roadmap
   discussion) so a business sees an expected cost range before running
   it, not after.
4. **Templates are versioned independently.** Improving the invoice
   extractor's verifier must not require touching or re-testing the
   transaction categorizer.
5. **Every template run produces an evidence record** — no exception.
   This is inherited for free from the kernel (`buildEvidence()`), but it
   is a hard requirement here because it's the actual trust mechanism a
   business owner without a compliance team relies on.

## Success metrics

- Cost per resolved task, per template, benchmarked against an
  always-frontier baseline (via PRD-001's acceptance methodology).
- % of runs requiring human review (approval-gated templates) vs. fully
  automated (verifier-passed) templates — the trust proxy from
  [docs/product/README.md](README.md).
- Time from "business points template at their data" to first successful
  automated run — target: under an hour, not a multi-day integration
  project. (This requirement flows into PRD-004: a template is only as
  fast to adopt as its data source is easy to connect.)

## Dependencies

- PRD-001 (`EscalatingReasoner`) for the cost story each template needs
  to actually deliver, not just claim.
- `@naro/policy` for `require_approval` gating on customer-facing
  templates.
- `@naro/verification` for the deterministic/schema verifiers; a
  secondary-model verifier (transaction categorizer's low-confidence
  path) is new but composes with existing `Verifier` interface.
- PRD-004 for real data source connections (bank feeds, document
  sources, email) — templates are testable against fixtures before
  PRD-004 ships, but not usable by a real business without it.

## Risks and open questions

- **Verifier quality is the whole product for the two "objective"
  templates.** A category-membership check only proves the answer is in
  the allowed set, not that it's the *right* category — false confidence
  is worse than no automation. Needs real-data validation against
  labeled historical transactions before calling a template "shipped,"
  not just a schema check passing.
- **Human-approval templates (email/review drafts) still need a UI** —
  presumably the console (PRD-003) or an even lighter surface (email
  digest with approve/edit/reject links). Not designed here; flagged as
  a PRD-003 dependency.
- **Should templates be free-standing packages** (`@naro/template-*`) or
  entries in one `@naro/templates` package? Leaning toward one package
  with independent internal versioning (requirement 4) until there's a
  reason to split — avoids five near-empty packages for five small
  templates.

## Milestones

1. Transaction categorizer, offline (fixtures, `MockModel` tiers) —
   prove the shape.
2. Transaction categorizer, real data, real benchmark numbers.
3. Invoice/receipt extractor, same bar.
4. Human-approval templates (email/review draft), gated on a usable
   approval UI existing (PRD-003 or a lighter interim surface).
