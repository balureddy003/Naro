# Deploying Naro

Naro has no required infrastructure: a runner is a library call and the
journal is a file. This guide is about the three topologies that exist in
practice and what each one needs. Ships in the repo: `Dockerfile`,
`deploy/compose.yml`, `deploy/k8s/naro.yaml`.

## Topology 1 — single process (default)

One `naro serve` process, SQLite durability (`node:sqlite` — no server to
run), local environments. This is the right answer for a laptop, a sidecar,
or a small service. Nothing else to deploy.

- Durability: `SqliteCheckpointStore`, `SqliteEventStore`, `SqliteMemoryStore`
  on a mounted volume.
- Recovery: checkpoint resume, or `wake()` from the journal — the WAL-backed
  file is the session.
- Limit: one host. Leases are `SqliteLeaseStore` — they coordinate processes
  sharing the database file, not machines.

## Topology 2 — multi-host control plane

N replicas of `naro serve` behind a load balancer, every durable port on
Postgres (`@naro/adapter-pg` — events, checkpoints, memory, leases, limits,
agent bus). This is the deploy/k8s manifest.

- **Session survives pod death.** The journal is in Postgres, not memory:
  `wake(runId)` on any pod rebuilds the run — same runId, same hash chain.
- **Exactly one driver per agent.** `PgLeaseStore` acquire/heartbeat/fence
  gives mutual exclusion across pods. A lost lease surfaces as a replan,
  not a second writer.
- **Work distribution.** `PgAgentBus` claims tasks with `SKIP LOCKED` —
  it's a durable queue; N pods drain it, no coordinator needed.
- **Rollouts.** `maxUnavailable: 0` + `/ready` probe + preStop sleep +
  SIGTERM drain: readiness flips, in-flight runs emit `agent.cancelled`
  (the journal records the interruption as evidence), peers pick up work.

## Topology 3 — hands as cattle

The runner (brain) and environments (hands) are separate processes.
`serveEnvironment` exposes any `Environment` over HTTP; `HttpEnvironment`
is the client — same contract either way. Environments scale, restart, and
swap independently; a dead one is a failed observation, not a crashed run.

- Deploy environments close to what they touch (a workspace env next to the
  workspace, a browser env next to the browser farm).
- `signal` and secrets never cross the wire — see ADR 0008.
- Abort does not propagate over HTTP: a remote action runs to completion
  once started. Idempotency keys reconcile, same as local timeouts.

## Topology 0 — Naro isn't the harness

With `@naro/adapter-harness`, none of this is your problem: keep Claude
Agent SDK / OpenCode, inject `claudeHooks`/`openCodePlugin`, and the policy
gate + journal run underneath. Export the journal to SQLite/Postgres and
`naro verify` audits runs Naro never drove.

## Networking

| Surface | Transport | Auth |
|---|---|---|
| `naro serve` control plane | HTTP | `NARO_SERVE_TOKEN` bearer (optional); TLS at the LB/ingress |
| `serveEnvironment` | HTTP | shared bearer token; put it behind mTLS or a private subnet |
| `HttpAgentBus` | HTTP | HS256 JWT or JWKS/OIDC (`multiagent/auth.ts`) |
| Outbound fetches (tools) | HTTPS | `safe-fetch`: domain allowlist, SSRF/private-IP blocking, redirect revalidation |

API surface: `POST /goals {description, successCriteria?, idempotencyKey?}`
→ `202 {runId}` — a retried `idempotencyKey` returns `200 {runId,
deduplicated: true}` (dedupe checks the shared `RunRegistry`, so retries are
safe across replicas), and the returned `runId` IS the journal `runId`, so
events, exports, and `wake(runId)` correlate with it. `GET /runs` reads the
registry, `GET /runs/:id`, SSE tail at `GET /runs/:id/events` — live on the
owning replica, replayed from the shared journal elsewhere — `GET
/approvals` + `POST /approvals/:id` when `--approvals <db>` wires a shared
`SqliteApprovalBridge`, `GET /health` + `GET /ready` probes
(unauthenticated), 64 KiB body cap, and SIGTERM drain — in-flight runs
abort and their journals end `agent.cancelled`.

With `--registry` + `--journal` (or the Pg equivalents), N-replica
`naro serve` is real: any replica answers `/runs` and `/runs/:id/events`
for every run, and approvals are shared. **Metrics** are OTel push
(logs/events); a `/metrics` scrape endpoint is a reasonable next addition.

Internal rule: **never expose a Naro port without something in front of it.**
The built-in bearer checks are a minimal gate, not an authz model — tenant
identity is deployment-owned (ADR 0008, production-readiness §10).

## Scaling dimensions

- **Runs per pod** — a pod runs many concurrent runs; bounded by memory and
  `maxIterations`, not by the runtime.
- **Pods** — stateless except in-flight runs; Postgres holds the session.
  Scale on CPU/request latency like any service.
- **Environments** — scale per domain independently; `ShardedExecutor` pins
  a target to an executor instance when affinity matters (tenant
  workspaces, browser sessions).
- **Bus throughput** — `PgAgentBus` scales like a Postgres queue; for
  extreme fan-out, Redis/other `AgentBus` implementations are the port.

## What is still yours

- Container/VM sandboxing for hostile code (`SandboxedExecutor` is a worker
  thread, not an OS sandbox — run untrusted execution in a separate,
  isolated environment over `serveEnvironment`).
- Secret management — `ExecContext.secrets.resolve` is the port; wire it to
  Vault/AWS SM/k8s secrets. Resolved values never enter the journal.
- **Seal key custody** — `sealKey` signs each run's journal head with
  Ed25519. The sealing key can forge a consistent chain, so it must live
  outside the writer's reach (KMS/HSM, a signing sidecar). See
  production-readiness §5.
- Backup, retention, migration policy for the Postgres tier.
- TLS termination and tenant-level authorization.

## Releasing

Packages publish via changesets (`.changeset/`, `@changesets/cli`,
`release.yml`): PRs carry changesets → merge to `main` → the action opens a
version PR → merging publishes to npm with provenance attestation
(`--provenance`, `id-token: write`), and `npm run check` gates every
publish. The only missing piece is the `NPM_TOKEN` repository secret —
once set, merging the version PR releases all `0.1.0` packages.
