---
"@naro/chat-ui": minor
"@naro/cli": minor
"@naro/client": minor
"@naro/tools": minor
"@naro/runtime": minor
"@naro/adapter-pg": minor
"@naro/core": minor
"@naro/observability": minor
---

PRD-006 end-to-end: `@naro/chat-ui` — the self-deployable chat interface
where an outcome template is one object with Runs/Settings/Access tabs,
served by `naro serve` as static ESM (no bundler). Plus its control-plane
prerequisites:

- ADR 0024 (accepted): `naro serve` admin routes — tool-collision
  list/resolve, definition-change list/acknowledge, attested run pruning
  (`POST /admin/runs/:id/prune`), plus `ToolRegistry.changedDefinitions()`.
- ADR 0025 (accepted): `PrincipalStore` port + `InMemory`/`Sqlite` impls —
  live, hash-at-rest identity for `naro serve`; `GET/POST/DELETE
  /admin/principals` issue and revoke without restart, tokens shown once.
- ADR 0026 (accepted): `GET /me` — authenticated self-description so UIs
  render role-accurate surfaces without probing privileged endpoints.
- `RunSummary.specName` — the spec's declared name on run rows, so runs
  group under the template that produced them (`tpl:<id>`).
- `POST /goals` accepts `template`, threaded to the runner factory.
- `@naro/client` gains `me()`, `cancelRun`, `cancelAllRuns`, and typed
  wrappers for every ADR 0024/0025 endpoint.
- `journal.retention.pruned` markers can carry `by` (principal
  attribution, signed into the marker when sealed).
