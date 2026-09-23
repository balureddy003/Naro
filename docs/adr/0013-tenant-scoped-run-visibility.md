# 0013 — Tenant-scoped run visibility on the control plane

Status: accepted
Date: 2026-09-23

## Context

[ADR 0012](0012-control-plane-identity.md) deliberately deferred tenant
authorization to the deployment: `naro serve` is designed to sit behind an
organization's gateway, and production-readiness §10 already lists
"organization-specific service identity and tenant authorization" as a
multi-host production gap the deployment must supply. That stance is
unchanged by this record — Naro is not becoming a multi-tenant platform.

What changed: a self-hosted, single-`naro serve`-process deployment with no
gateway in front of it (the common case before a team has built one) has no
way to run more than one tenant's agents against the same control plane
without every `viewer`/`operator`/`approver` principal seeing every other
tenant's runs through `GET /runs`. That is a real, cheap-to-close gap for
exactly the zero-infrastructure posture the rest of `naro serve` targets
(SQLite by default, Postgres for multi-host) — it does not require solving
full tenant isolation to be worth having.

## Decision

`Principal` gains an optional `tenantId`. When present:

- `POST /goals` stamps the created run's `RunSummary.tenantId` from the
  calling principal.
- `GET /runs` filters to the caller's `tenantId`.
- `GET /runs/:id` and `GET /runs/:id/events` return `404` (not `403`) for a
  run outside the caller's tenant — a cross-tenant probe learns nothing
  about whether the run exists, matching the existing "unknown run" shape.

A principal without a `tenantId` sees everything, as today — this is
additive: deployments that don't set `tenantId` observe no behavior change.
`RunRegistry.list()` gains an optional `tenantId` filter; `InMemoryRunRegistry`,
`SqliteRunRegistry`, and `@naro/adapter-pg`'s `PgRunRegistry` all implement it.

**Explicitly out of scope for this record:** `GET /approvals` and
`POST /approvals/:id` are not tenant-scoped. `ApprovalRequest` has no
run/tenant linkage today (approvals are addressed by their own id, not by
run), and adding one means a schema change to `SqliteApprovalBridge` and
`PgApprovalBridge` on top of the run-registry change here. Splitting that
into its own record keeps this one reviewable and keeps the run-registry
change from waiting on a decision about approval-tenant linkage. Until
then, any `approver` principal sees and can answer every pending approval
regardless of tenant — document this plainly to operators, don't paper
over it.

## Alternatives considered

- **Full tenant authorization in Naro (row-level security, tenant-scoped
  policy, per-tenant rate limits).** Rejected for the reason ADR 0012 gave:
  that's the deployment's job, and Naro re-implementing an organization's
  identity/authz stack is scope creep the project has already declined
  once. This record adds *visibility scoping* only — it is not a security
  boundary a hostile principal can't route around if the deployment trusts
  it with a token in the first place.
- **JWT claims carrying tenant, verified centrally.** `naro serve`'s
  `jwksVerifier` (via a `TokenVerifier`-shaped principal source) could
  supply `tenantId` from a JWT claim instead of the static `principals`
  map — compatible with this record's shape (tenantId lives on `Principal`
  regardless of where the map comes from), left for whoever wires JWT
  principals in, not a reason to block this.
- **Do nothing; tell every self-hosted deployment to put a gateway in
  front.** Rejected: it is a correct instruction and also not free — a
  gateway is infrastructure a team building their first agent doesn't have
  yet, and "every principal sees every tenant's runs" is a bad default
  even for a week.

## Consequences

- Additive and backward compatible: a principal with no `tenantId`, or a
  deployment with no `principals` configured at all, behaves exactly as
  before. Old `RunSummary` rows (SQLite and Postgres) have no `tenant_id`
  and are simply invisible to a tenant-scoped `list()` call until
  re-upserted — acceptable, since a run predating this record predates any
  tenant concept to scope it by.
- `GET /runs/:id` for a foreign tenant's run now costs an extra registry
  read to discover the mismatch before returning 404 — negligible next to
  the network round trip itself.
- This is visibility scoping, not isolation: a principal's token still
  grants whatever roles it grants, across the whole process. Two tenants
  sharing one `naro serve` process still share its policy engine, its
  budgets, and its crash blast radius. A deployment that needs real
  tenant isolation still needs separate processes (or ADR 0012's original
  answer: a gateway), not just this record.
- `@naro/adapter-pg`'s `PgRunRegistry` migration adds `tenant_id TEXT` via
  `ALTER TABLE IF NOT EXISTS` — safe on an existing database, no downtime
  migration required. `SqliteRunRegistry` gains its first `migrate()` step
  for the same reason, following `SqliteApprovalBridge`'s established
  pattern for old-database compatibility.
