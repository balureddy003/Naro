# PRD-003 — Managed Control Plane

Status: proposed
Owner: unassigned
Depends on: [PRD-002](prd-002-outcome-templates.md), `naro serve`, `@naro/adapter-pg`, `@naro/client`

## Summary

A hosted version of `naro serve` — Postgres-backed, multi-tenant, running
outcome templates (PRD-002) — because a small business will not run
`docker compose up` and manage its own database. Priced per verified
outcome, not per seat or per token.

## Problem

Every piece this needs already exists as self-hosted infrastructure:
`naro serve --pg <url>` durable across replicas
([docs/deploy.md](../deploy.md)), `@naro/client` and the ops console for
inspection, `ADR 0013`'s tenant-scoped run visibility. None of it is
something a small business can stand up themselves. The gap is
operational, not architectural: someone has to run the Postgres instance,
the `naro serve` processes, TLS, backups, and billing.

## Goals

- A business signs up, picks a template (PRD-002), connects their data
  (PRD-004), and gets a working automation without provisioning anything.
- Pricing is legible in the terms a roadmap discussion already committed
  to: **cost per verified outcome**, not a per-seat subscription or a raw
  token meter — the thing SMBs already distrust about existing AI
  pricing.
- Every run remains individually auditable by the business through the
  console, exactly as a self-hosted deployment would show it — hosting
  does not mean hiding the evidence trail.

## Non-goals

- A general-purpose multi-tenant SaaS platform for arbitrary agents. This
  is scoped to running PRD-002's templates for SMB customers, not an
  open platform for arbitrary third-party workloads in v1.
- Replacing self-hosting. `naro serve` self-hosted remains fully
  supported and documented ([docs/deploy.md](../deploy.md)) — this is an
  additional option, not a deprecation of the existing path.
- Enterprise SSO/SCIM, org hierarchies, or anything ADR 0013 already
  marked as "the deployment's job" for the kernel. A small business
  customer is typically one org with a handful of named users; the
  existing `--principals` role model is likely sufficient for v1.

## Users and scenario

**Primary user:** a small business owner or office manager, not a
developer. They should never need to read `docs/deploy.md`.

**Scenario:** sign up, connect a bank feed (PRD-004), pick "categorize
transactions," see the first week's results in the console with a cost
total, approve or correct a handful of low-confidence ones, and the
system keeps running.

## Functional requirements

1. **Multi-tenant from day one, using ADR 0013's existing mechanism.**
   Each customer is a `tenantId`; `GET /runs` visibility scoping already
   works. ADR 0013 is explicit that this is visibility scoping, not full
   isolation — this PRD's operational design (separate Postgres
   schemas/databases per tenant, or process-per-tenant at higher tiers)
   must supply the isolation ADR 0013 deliberately left to the
   deployment.
2. **Outcome-based billing requires a real cost ledger**, not an
   estimate. Every run's `model.usage` totals (already in the journal)
   roll up into a per-tenant, per-outcome cost record. This is new
   product surface — the kernel emits the raw events, nothing currently
   aggregates them into a bill.
3. **Onboarding is template selection, not agent configuration.** The
   business picks from PRD-002's library and answers template-specific
   setup questions (which categories, which tone) — they never see
   `Reasoner`, `PolicyEngine`, or `ActionExecutor` by name.
4. **The console (or a business-facing view built on `@naro/client`) is
   the primary interface**, not a developer tool repurposed. The
   existing ops console is aimed at an operator who understands runs and
   evidence trees; a business owner needs a simpler surface — likely a
   distinct, business-facing UI built on the same `@naro/client` SDK
   (exactly the "template built on the headless SDK" pattern the SDK was
   designed for), not the console itself relabeled.
5. **Draining, backup, and restore are the operator's job, invisibly.**
   `naro serve`'s existing SIGTERM drain and Postgres durability are the
   mechanism; this PRD adds the operational practice (backup schedule,
   restore runbook, on-call) around them, not new kernel code.

## Success metrics

- Time from signup to first automated outcome — target under an hour,
  consistent with PRD-002's adoption-speed requirement.
- Cost-per-outcome billed vs. cost-per-outcome actually incurred
  (margin, tracked honestly — this is a business viability metric as
  much as a product one).
- % of tenants who ever look at the evidence trail unprompted — a proxy
  for whether the trust story is actually landing, not just claimed.

## Dependencies

- PRD-002 templates to run.
- `@naro/adapter-pg` for the durable multi-host backing store (already
  ships every port: `PgRunRegistry`, `PgEventStore`, `PgApprovalBridge`,
  `PgLeaseStore`, `PgLimitStore`).
- `@naro/client` as the SDK the business-facing UI is built on.
- A real secrets story for tenant-supplied credentials (PRD-004's data
  connections) — `@naro/adapter-vault` or an equivalent, not values in
  configuration.

## Risks and open questions

- **ADR 0013 is explicit that its tenant scoping is visibility, not
  isolation** — "tenants sharing a `naro serve` process still share its
  policy engine, budgets, and crash blast radius." A paying multi-tenant
  product cannot ship on visibility scoping alone; this PRD needs its own
  isolation decision (database-per-tenant at minimum, process-per-tenant
  for higher tiers) before it is buildable, not assumed from ADR 0013.
- **Billing accuracy is a hard requirement, not a nice-to-have** — an
  SMB customer disputing a bill they can't independently verify
  reproduces the exact trust problem this whole roadmap exists to solve.
  The cost ledger needs its own reconciliation story against provider
  invoices, which is unscoped work today.
- **This is the first PRD in the set that is a real hosted service with
  uptime expectations**, not a library or a self-hosted option. That is
  a different operational commitment than anything shipped so far in
  this repository and should be sized accordingly before committing to a
  timeline.

## Milestones

1. Single-tenant hosted deployment (one customer, manual onboarding) to
   validate the template-run-console loop end to end before building
   multi-tenant infrastructure.
2. Cost ledger + outcome-based billing, validated against at least one
   full billing cycle's provider invoices.
3. Self-service signup + business-facing UI.
4. Multi-tenant isolation hardening once tenant count justifies it.
