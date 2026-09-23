---
"@naro/runtime": minor
"@naro/adapter-pg": minor
"@naro/cli": minor
---

Optional tenant-scoped run visibility on `naro serve` (ADR 0013), and a
read-only ops console.

- `RunSummary.tenantId?` and `RunRegistry.list({tenantId?})` — implemented
  by `InMemoryRunRegistry`, `SqliteRunRegistry` (migrates existing
  databases), and `@naro/adapter-pg`'s `PgRunRegistry` (`ALTER TABLE ...
  ADD COLUMN IF NOT EXISTS`, safe on a live database).
- `naro serve`'s `Principal` gains an optional `tenantId`; when set, it
  scopes `GET /runs`, `GET /runs/:id`, and `GET /runs/:id/events` to that
  tenant's runs (`404`, not `403`, cross-tenant). A principal with no
  `tenantId`, or a deployment with no `principals` configured, is
  unaffected. This is visibility scoping within one process, explicitly
  not full tenant isolation and explicitly not covering
  `GET /approvals`/`POST /approvals/:id` — see ADR 0013 for the reasoning
  and the deliberately-out-of-scope parts.
- `GET /console`: a static, dependency-free HTML page for browsing runs,
  tailing a run's events live, and answering approvals — on by default,
  disable with `--no-console`/`console: false`. The page needs no auth to
  load (it carries no data); every API call it makes goes through the
  same bearer-token gate as any other client.
