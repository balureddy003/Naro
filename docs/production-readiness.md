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

## 2. Secrets

- Put secret references in configuration or actions, never values.
- Configure `EnvSecretProvider`, `MapSecretProvider`, a chained provider, or a
  deployment-specific vault adapter.
- Resolve through `ExecContext.secrets` inside the executor.
- Do not return resolved values in observations or errors.
- Redact external telemetry as a backstop.

Naro does not include a Vault, cloud KMS, or managed secret backend today.

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
optional reasoner state, run ID, and journal sequence.

| Implementation | Scope | Use |
|---|---|---|
| `InMemoryCheckpointStore` | one process | tests |
| `FileCheckpointStore` | one host, JSONL | local development |
| `SqliteCheckpointStore` | one host, transactional | durable local service |
| `JsonlExporter` | one host, append-only events | simple audit |
| `SqliteEventStore` | one host, queryable events | durable journal and run lookup |
| `SqliteMemoryStore` | one host, FTS5 memory | persistent recall |

Resume is at-least-once. A crash after an external side effect but before its
observation is checkpointed can reissue the logical action. Idempotency and
reconciliation are part of the production design.

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

Events are immutable snapshots with stable `runId` and ordered `seq`. OTLP
export currently uses log records rather than a trace-span hierarchy.

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
`PgMemoryStore`, `PgLeaseStore`, `PgLimitStore`, and `PgAgentBus` (atomic
`SKIP LOCKED` claims, single-statement upsert quotas). Its integration tests
run against a real Postgres service container in CI. A multi-host platform
still needs deployment-specific services for:

- container or VM isolation;
- organization-specific service identity and tenant authorization;
- centralized secret management;
- backup, migration, retention, and disaster recovery;
- release and checkpoint-schema compatibility policy.

Provider failover and circuit breaking are in-process (`failover`,
`retrying`); token and cost budgets are enforced by `AgentDeps.budgets`.
