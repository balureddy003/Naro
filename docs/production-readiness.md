# Production Readiness

This checklist separates guarantees available in the repository from controls a
deployment must provide. Passing the test suite does not make an arbitrary
agent safe for production.

## 1. Authorization

- Supply `AgentRunner.policy`; it is required.
- Cover every action target scheme, not only `tool://`.
- Keep a final deny rule for unmatched production actions.
- Grant the minimum capabilities to each agent.
- Require human approval for irreversible actions.
- Use `@naro/adapter-opa` when policy must be centrally managed in Rego.

`createToolPolicy()` denies unknown registered-tool names and checks tool
permissions and side effects. Its default `otherwise: 'allow'` means “this
engine does not own non-tool schemes,” not “all environments are safe.”

The `naro serve` control plane has its own authorization: `--principals`
maps bearer tokens to `{id, roles}` — `viewer` reads runs and the approval
queue, `operator` submits goals, `approver` answers approvals
(operator/approver imply viewer). `--token` is shorthand for one admin
principal. Missing or bad credentials get 401; insufficient role gets 403.
This is a control-plane role check, not tenant authz — that still belongs
to the deployment in front.

## 2. Secrets

- Put secret references in configuration or actions, never values.
- Configure `EnvSecretProvider` (`env:`), `FileSecretProvider` (`file:` —
  mounted secret volumes, cached with a 60s TTL so rotations are picked
  up), `MapSecretProvider`, `@naro/adapter-vault`'s `VaultSecretProvider`
  (`vault:` — HashiCorp Vault KV v2, same TTL-cached posture), or a
  chained provider composing several of these.
- Resolve through `ExecContext.secrets` inside the executor.
- Do not return resolved values in observations or errors.
- Redact external telemetry as a backstop.

Naro does not include a cloud KMS or managed secret backend today. Vault
token lifecycle (AppRole login, renewal, Kubernetes auth) stays a
deployment concern — `VaultSecretProvider` takes a static token or a
caller-supplied header, not a login flow.

## 3. Execution isolation

`SandboxedExecutor` provides a fresh worker thread, V8 resource limits, and
worker termination on timeout or abort. It isolates crashes, module state, and
heap exhaustion.

It does **not** isolate operating-system authority. A worker can use the host
filesystem and network available to the Node process. Run hostile code in a
container, VM, or external sandbox service behind `ActionExecutor`.

Domain profiles add their own controls:

- coding: realpath workspace jail and bounded output;
- research/browser: destination allowlists and redirect revalidation;
- data: database-enforced read-only query path and parameter binding;
- DevOps: declared argv runbooks instead of arbitrary shell;
- workflow: required policy on every nested step;
- robotics: environment latch plus out-of-band emergency stop.

## 4. Timeout, cancellation, and retry

A per-action deadline aborts a child `AbortSignal`. The executor must propagate
or honor it. Worker-thread sandbox execution terminates the worker directly.

Cancellation is not rollback. A remote write may commit before noticing abort.
Treat a timed-out write as indeterminate and reconcile authoritative state.

Retry only operations known to be repeatable. Naro supplies a deterministic
default action `idempotencyKey`; the target system must store and enforce it.

## 5. Checkpoint and event durability

A checkpoint contains tasks, actions, observations, context, iteration,
optional reasoner state, run ID, journal sequence, and hash-chain head.

| Implementation | Scope | Use |
|---|---|---|
| `InMemoryCheckpointStore` | one process | tests |
| `FileCheckpointStore` | one host, JSONL | local development |
| `SqliteCheckpointStore` | one host, transactional | durable local service |
| `JsonlExporter` | one host, append-only events | simple audit |
| `SqliteEventStore` | one host, queryable events | durable journal and run lookup |
| `SqliteMemoryStore` | one host, FTS5 memory | persistent recall |
| `SqliteRunRegistry` | one host, run index | `naro serve --registry` |

`RunRegistry` is the durable run index `naro serve` upserts into — SQLite
here, `PgRunRegistry` on Postgres — so `/runs` survives restarts and is
shared across replicas.

Resume is at-least-once. A crash after an external side effect but before its
observation is checkpointed can reissue the logical action. Idempotency and
reconciliation are part of the production design.

Retention splits operational stores from evidence.
`SqliteApprovalBridge.prune`/`PgApprovalBridge.prune` and
`SqliteCheckpointStore.prune`/`PgCheckpointStore.prune` delete answered
requests and superseded checkpoints — operational records, prune freely. The
journal is the evidence: it is exported and sealed, never deleted. Approval
rows carry `expires_at` (`created_at + timeoutMs`), so unanswered requests
expire instead of pending forever, and `answered_by` attributes each answer
to the principal that posted it.

Every emitted event carries `prev`/`hash`, a SHA-256 chain `verifyChain()`
recomputes and `naro verify <run.jsonl>` checks. With `AgentDeps.sealKey`,
the runner emits a terminal `journal.sealed` event — an Ed25519 signature
over the chain head — so a rewritten or extended journal fails signature
verification against the public key (`--pubkey` pins it). The chain is
**tamper-evident; sealed, it is tamper-evident with attribution**: the
remaining gap is key custody — the sealing key can still forge a consistent
chain, so keep it outside the journal writer's reach (KMS/HSM) or stream
events to a store the writer cannot modify (a `PgEventStore` under different
credentials) and verify against that copy. Sealing is terminal by
convention — `wake()` refuses a sealed journal. Events exported before
chaining existed carry no `hash` and never verify — `verifyChain` reports
them as `journal is not hash-chained`.

Cost: the chain is cheap — `scripts/bench-chain.mjs` measures ~270k
events/s emitted (canonicalize + SHA-256 + link) and ~390k events/s
verified on commodity hardware. A 100k-event journal verifies in ~250ms.
Ed25519 sealing adds one signature per run, not per event.

## 6. Concurrent runners and leases

Configure `AgentDeps.lease` when multiple processes can start the same agent.
`SqliteLeaseStore` gives atomic acquire and heartbeat for processes sharing one
SQLite database.

A second runner fails during initialization while the lease is live. If a
running process loses its lease, the current implementation emits a
`replan.triggered` event; it does not forcibly stop execution. Monitor that
event and use stronger fencing in the external systems for high-impact writes.
Multi-host deployments need a shared `LeaseStore` — `@naro/adapter-pg`
provides `PgLeaseStore` on Postgres.

## 7. Multi-agent delivery

| Bus | Guarantee |
|---|---|
| `InMemoryAgentBus` | direct, process-local request/reply |
| `HttpAgentBus` | synchronous network request/reply with pluggable bearer verification |
| `DurableAgentBus` | SQLite persistence and at-least-once single-host delivery |
| `A2aAgentBus` | agent cards plus synchronous JSON-RPC `tasks/send` subset |

Use `TokenVerifier` for HTTP serving. Shared secrets are appropriate for local
or controlled deployments; `hmacTokenVerifier` supports HS256 JWT validation.
`jwksVerifier` discovers or directly loads JWKS, verifies RS256/ES256 signatures,
pins issuer/audience/expiry, caches keys, and refreshes on rotation. Deployments
still own TLS/mTLS, credential rotation policy, and tenant authorization.

Durable handlers must be idempotent because stale claims are reclaimed. A
request timeout does not prove remote work stopped.

## 8. Observability

- consume `runner.events()` or attach exporters before starting the run;
- persist important events with JSONL or `SqliteEventStore`;
- wrap external exporters with redaction;
- call `flush()` before process exit;
- alert on denials, approval volume, replans, checkpoint failures, lease loss,
  timeouts, cost growth, and failed verification;
- export OTLP logs through `@naro/adapter-otel` when using a collector.

Events are immutable snapshots with stable `runId` and ordered `seq`, hash-chained
per run (see §5). `naro verify <file.jsonl>` recomputes the chain and prints the
per-action evidence record; wire it into audit and incident-review flows. Gate
events carry `PolicyEngine.id` (`policy` on `permission.requested` /
`action.permitted` / `action.denied` / `human.approval.requested`), and
`human.approval.received` carries the approver's control-plane identity
(`by`) — the journal alone answers "who approved this and under which
policy." OTLP export currently uses log records rather than a trace-span
hierarchy.

## 9. Evaluation and release gates

- cover normal, failure, denial, approval, timeout, injection, and recovery
  cases;
- use deterministic verifiers where possible;
- calibrate LLM judges against human labels;
- save benchmark reports with `naro bench --save`;
- compare against a committed baseline with `--baseline`;
- investigate removed cases as regressions, not only changed pass/fail status;
- run `npm run check` and `npm run pack:check` in CI;
- use changesets for reviewed package versioning and publishing.

## 10. Multi-host production gaps

The repository provides a strong zero-infrastructure single-host substrate
(SQLite) plus `@naro/adapter-pg`, which implements every durable port on
Postgres for multi-host deployments: `PgCheckpointStore`, `PgEventStore`,
`PgMemoryStore`, `PgLeaseStore`, `PgLimitStore`, `PgAgentBus` (atomic
`SKIP LOCKED` claims, single-statement upsert quotas), `PgRunRegistry`, and
`PgApprovalBridge` — so `naro serve`'s run index, event journal, and
human-in-the-loop approval queue are all answerable from any replica, not
just the run registry and journal. Its integration tests run against a real
Postgres service container in CI.

Deployment artifacts ship in-repo: a root `Dockerfile` (Node 22-alpine,
type-stripped — no build step), `deploy/compose.yml` (Naro + Postgres), and
`deploy/k8s/naro.yaml` (rolling Deployment with `/health`+`/ready` probes,
preStop drain, Postgres-backed session). `naro serve` drains on SIGTERM —
readiness flips and in-flight runs journal `agent.cancelled`. See
[deploy.md](deploy.md) for the four topologies and the networking matrix.

A multi-host platform still needs deployment-specific services for:

- container or VM isolation (`SandboxedExecutor` is a thread, not a sandbox);
- organization-specific service identity and tenant authorization;
- centralized secret management;
- backup, migration, retention, and disaster recovery;
- release and checkpoint-schema compatibility policy.

Provider failover and circuit breaking are in-process (`failover`,
`retrying`); token and cost budgets are enforced by `AgentDeps.budgets`.
