# @naro/cli

Developer commands for running, scaffolding, inspecting, and regression-testing
agents.

```bash
naro init <dir> [--reasoner react|direct]
naro run <agent.ts>
naro bench <bench.ts> [--save reports.jsonl] [--label name]
                       [--baseline baseline.jsonl]
naro replay <events.jsonl>
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
it does not re-execute external side effects.

### `states`

Prints the current transition table directly from `AGENT_STATES` and
`TRANSITIONS`.

### `serve`

`naro serve <module.ts> [--port N] [--host h]` exposes an agent as a service.
The module must export a runner factory; the server accepts `POST /goals`,
streams run events over SSE (`GET /runs/:id/events`), and supports result
polling (`GET /runs/:id`).

### `approvals` / `approve`

`naro approvals --db <file.db>` lists pending human-in-the-loop requests from
a `SqliteApprovalBridge`; `naro approve <id> --db <file.db> [--deny] [--note
n]` resolves one. Because the queue is durable, a parked run survives process
restarts — the operator approves later and the run resumes.

## Design

`main(argv, io)` is testable without a process shell. Agent and benchmark
modules are dynamically imported, so the CLI does not introduce a hidden
configuration model.
