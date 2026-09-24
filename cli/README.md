# @naro/cli

Developer commands for running, scaffolding, inspecting, and regression-testing
agents.

```bash
naro init <dir> [--reasoner react|direct]
naro run <agent.ts>
naro bench <bench.ts> [--save reports.jsonl] [--label name]
                       [--baseline baseline.jsonl]
naro replay <events.jsonl>
naro verify <events.jsonl> [--json]
naro states
```

## Commands

### `init`

Scaffolds a small TypeScript workspace with an explicit policy gate and a
working reasoner. It refuses to overwrite an existing destination. The scaffold
uses development-safe defaults and points to provider adapters for live models.

### `run`

Runs an agent module using Node's native TypeScript support. The agent file is a
normal program; composition remains explicit.

### `bench`

Imports an `EvalCase[]` from a named `cases` export or default export. Any
failed case returns exit code `1`.

- `--save` appends a report to `JsonlReportStore`.
- `--label` identifies the stored report.
- `--baseline` compares with the latest stored baseline and returns `1` for
  regressions, including silently removed cases.

### `replay`

Reads a JSONL event artifact, prints its ordered events, and derives the same
behavior metrics used by live evaluation. It replays the journal for inspection;
it does not re-execute external side effects. The summary line includes the
hash-chain verdict.

### `verify`

Recomputes a JSONL journal's hash chain and prints the per-run evidence
record — for each action: policy outcome → observation → verifier verdict,
plus the goal verification and the run outcome. `--json` emits the
machine-readable `EvidenceRecord`. `--pubkey key.pem` additionally pins the
sealing key: a sealed journal verifies its `journal.sealed` signature
against the embedded public key, and `--pubkey` requires it to match yours.

- exit `0`: chain intact (and seal valid / key matches when present);
- exit `1`: chain broken (tampered, truncated, reordered, post-seal events,
  bad signature, key mismatch) or the journal predates chaining;
- exit `2`: usage error.

### `prune`

`naro prune <store.db> --run <id> --before <seq|ISO-date> [--reason <policy>]
[--seal-key key.pem]` — attested retention pruning on a `SqliteEventStore`
([ADR 0018](../docs/adr/0018-attested-retention-pruning.md)). Instead of
deleting rows silently (which makes a pruned journal indistinguishable from
a tampered one), it writes a `journal.retention.pruned` marker as the run's
new first event — carrying `prunedThroughSeq`, the `anchorHash` of the last
removed event, and an optional Ed25519 attestation (`--seal-key`) — then
deletes the covered rows. Only terminal runs can be pruned, and the cutoff
must leave the terminal event. `naro verify` then reports the chain as OK
*with a disclosed prune* — verified from the anchor, never presented as a
complete journal.

### `states`

Prints the current transition table directly from `AGENT_STATES` and
`TRANSITIONS`.

### `serve`

`naro serve <module.ts> [--port N] [--host h] [--token t]` exposes an agent
as a service. The module must export a runner factory; the server accepts
`POST /goals`, streams run events over SSE (`GET /runs/:id/events`, with
`?since=<seq>` to resume a stream instead of re-replaying the whole
journal on every reconnect), serves the correlated evidence tree
(`GET /runs/:id/evidence` — `buildEvidence()` over the run's journal:
policy verdict → action → observation → verifier, computed once
server-side instead of re-derived by every client), and supports result
polling (`GET /runs/:id`). The `runId` returned by `POST /goals` is the
journal's `runId` — events, exports, and `wake()` all correlate with it.

Additional flags:

- `--registry <file.db>` — durable `RunRegistry` (`SqliteRunRegistry`);
  `GET /runs` answers from it, so the run index survives restarts and is
  shared between replicas pointed at the same store. Default: in-memory.
- `--journal <file.db>` — a shared `SqliteEventStore`; `GET /runs/:id/events`
  for a run a peer replica owns replays from it instead of 404ing.
- `--pg <url>` / `NARO_PG_URL` — Postgres-backed `PgRunRegistry` +
  `PgEventStore` for both ports at once, the N-replica control-plane story
  (`docs/deploy.md` topology 2). `--registry-pg <url>` / `--journal-pg <url>`
  override the shared URL per-store. An explicit `--registry`/`--journal`
  SQLite path always wins over Postgres for that same store. Requires the
  optional `pg` peer dependency (`npm install pg`) — `naro serve` without
  any Postgres flag never needs it.
- `--approvals <file.db>` — a shared `SqliteApprovalBridge`; exposes
  `GET /approvals` (pending queue) and `POST /approvals/:id
  {approved?|text?|note?}` so operators approve over HTTP — including
  cross-process, since the bridge is durable.
- `--principals <file.json>` — maps bearer tokens to `{id, roles, tenantId?}`.
  Roles: `viewer` (GET endpoints), `operator` (`POST /goals`,
  `POST /runs/:id/cancel`), `approver` (`POST /approvals/:id`), `admin`
  (`POST /runs/cancel-all` — fleet-wide halt, ADR 0022); operator/approver
  imply viewer, admin implies all. Insufficient role → `403 {error:
  'forbidden', required: <role>}`. The principal id is written to the
  approval (`answered_by`), journaled on `human.approval.received.by`, and
  stamped as `by` on `agent.cancelled` — who approved and who stopped a run
  is evidence. Supersedes `--token`/`NARO_SERVE_TOKEN`, which remains as
  shorthand for one admin principal (no `tenantId` — full visibility).
- `POST /runs/:id/cancel {reason}` — cancels one in-flight run through the
  same `AbortController` drain uses, without restarting the server.
  `reason` is required; `agent.cancelled` journals `reason` + `by`. Unknown
  or already-terminal runs are `404` — a cancel that returns 202 means the
  abort is landing.
- `POST /runs/cancel-all {reason}` — fleet-wide halt (admin). Tenant-scoped
  principals halt only their tenant's runs.
- `tenantId` on a principal ([ADR 0013](../docs/adr/0013-tenant-scoped-run-visibility.md))
  scopes `GET /runs`, `GET /runs/:id`, and `GET /runs/:id/events` to runs
  submitted under that tenant; a cross-tenant direct read is `404`. This is
  visibility scoping for a single process, not tenant isolation — it does
  not cover `GET /approvals`, and a deployment needing real isolation still
  needs separate processes or a gateway in front.
- `--principals-store <file.db>` — a live `SqlitePrincipalStore` ([ADR
  0025](../docs/adr/0025-live-principal-store.md)): bearer tokens resolve
  through the store on every request, and `admin` principals can issue and
  revoke identities over HTTP (`GET/POST /admin/principals`, `DELETE
  /admin/principals/:id`). Supersedes `--principals`/`--token` for
  authentication — the store is the identity source when configured.
  Generated tokens are shown once at issuance; the store holds only their
  SHA-256 hash + last-4.
- `GET /me` ([ADR 0026](../docs/adr/0026-me-authenticated-self-description.md))
  — the caller's own `{id, roles, tenantId?}` so UIs render role-accurate
  surfaces without probing privileged endpoints.
- Admin surface ([ADR 0024](../docs/adr/0024-admin-api-surface-for-registry-and-retention.md)),
  all `admin`-gated: `GET/POST /admin/tool-collisions[/resolve]`,
  `GET/POST /admin/tool-definitions/changed|acknowledge` (needs
  `toolRegistry` on `startAgentServer`), and `POST /admin/runs/:id/prune
  {throughSeq, policy?}` (needs a `PrunableEventStore` journal +
  `pruneSealKey` for attestation). Unconfigured dependencies → `501`, not
  a broken half-route.
- `POST /goals` accepts an optional `template` field, passed to the module's
  `createRunner(goal, {principal, template})` — how a deployment serving
  multiple outcome templates routes a submission.

Production surface: `GET /health` + `GET /ready` probes (unauthenticated),
optional bearer gate via `--token` or `NARO_SERVE_TOKEN`, 64 KiB body cap on
`POST /goals`, and SIGINT/SIGTERM graceful drain — in-flight runs are
aborted and their journals end with `agent.cancelled`. See
[docs/deploy.md](../docs/deploy.md).

### Ops console

`GET /console` serves a static, dependency-free HTML page (`console.ts` —
no build step, matches this package's own "runs straight from TypeScript
source" shape) for browsing runs, tailing a run's events live, and
answering pending approvals. The page itself needs no auth to load; you
paste a bearer token into it, and every API call it makes goes through the
same role-gated endpoints a script would use. Read-only except for
`POST /approvals/:id`, which already requires the `approver` role. Disable
it with `--no-console` / `console: false` if you'd rather not serve it at
all — this is not a replacement for a real operations dashboard, just
enough to look at a run without writing a client.

### Chat interface (PRD-006)

`GET /chat` serves `@naro/chat-ui` — the chat-shaped interface where an
outcome template is one object with Runs/Settings/Access tabs. Same
posture as the console: the shell needs no auth, every API call it makes
is role-gated, its compiled ESM is served under `/chat-ui/*.js` (no
bundler). `chatTemplates` on `startAgentServer` declares the template
manifest the sidebar lists; runs group under a template when their
spec name is `tpl:<id>`. Disable with `--no-chat` / `chat: false`.

### `approvals` / `approve`

`naro approvals --db <file.db>` lists pending human-in-the-loop requests from
a `SqliteApprovalBridge`; `naro approve <id> --db <file.db> [--deny] [--note
n]` resolves one. Because the queue is durable, a parked run survives process
restarts — the operator approves later and the run resumes.

## Design

`main(argv, io)` is testable without a process shell. Agent and benchmark
modules are dynamically imported, so the CLI does not introduce a hidden
configuration model.
