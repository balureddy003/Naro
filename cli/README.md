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

### `states`

Prints the current transition table directly from `AGENT_STATES` and
`TRANSITIONS`.

### `serve`

`naro serve <module.ts> [--port N] [--host h] [--token t]` exposes an agent
as a service. The module must export a runner factory; the server accepts
`POST /goals`, streams run events over SSE (`GET /runs/:id/events`), and
supports result polling (`GET /runs/:id`). The `runId` returned by
`POST /goals` is the journal's `runId` — events, exports, and `wake()` all
correlate with it.

Additional flags:

- `--registry <file.db>` — durable `RunRegistry` (`SqliteRunRegistry`);
  `GET /runs` answers from it, so the run index survives restarts and is
  shared between replicas pointed at the same store. Default: in-memory.
  Postgres (`PgRunRegistry`) is wired via the module, not a flag.
- `--journal <file.db>` — a shared `SqliteEventStore`; `GET /runs/:id/events`
  for a run a peer replica owns replays from it instead of 404ing.
- `--approvals <file.db>` — a shared `SqliteApprovalBridge`; exposes
  `GET /approvals` (pending queue) and `POST /approvals/:id
  {approved?|text?|note?}` so operators approve over HTTP — including
  cross-process, since the bridge is durable.
- `--principals <file.json>` — maps bearer tokens to `{id, roles}`. Roles:
  `viewer` (GET endpoints), `operator` (`POST /goals`), `approver`
  (`POST /approvals/:id`); operator and approver imply viewer. Insufficient
  role → `403 {error: 'forbidden', required: <role>}`. The principal id is
  written to the approval (`answered_by`) and journaled on
  `human.approval.received.by` — who approved is evidence. Supersedes
  `--token`/`NARO_SERVE_TOKEN`, which remains as shorthand for one admin
  principal.

Production surface: `GET /health` + `GET /ready` probes (unauthenticated),
optional bearer gate via `--token` or `NARO_SERVE_TOKEN`, 64 KiB body cap on
`POST /goals`, and SIGINT/SIGTERM graceful drain — in-flight runs are
aborted and their journals end with `agent.cancelled`. See
[docs/deploy.md](../docs/deploy.md).

### `approvals` / `approve`

`naro approvals --db <file.db>` lists pending human-in-the-loop requests from
a `SqliteApprovalBridge`; `naro approve <id> --db <file.db> [--deny] [--note
n]` resolves one. Because the queue is durable, a parked run survives process
restarts — the operator approves later and the run resumes.

## Design

`main(argv, io)` is testable without a process shell. Agent and benchmark
modules are dynamically imported, so the CLI does not introduce a hidden
configuration model.
