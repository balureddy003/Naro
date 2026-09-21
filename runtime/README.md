# @naro/runtime

The controlled execution engine for one agent run. `AgentRunner` is the only
component that changes agent state.

## Composition

```ts
const runner = new AgentRunner({
  spec,
  reasoner,
  executor,
  policy,              // required: Naro never guesses authorization
  verifier,
  human,
  grants,
  secrets,
  context,
  memory,
  checkpoints,
  lease,
  maxIterations: 64,
  actionTimeoutMs: 30_000,
  retry,
});
```

`allowAllPolicy` remains available from `@naro/core` for explicit test and local
wiring. Omitting policy is a type error.

## Public surface

| Export | Role |
|---|---|
| `AgentRunner` | drives reasoning, policy, execution, observation, verification, recovery, and events |
| `EventBus` | immutable event snapshots, ordered by `runId` and `seq` |
| `CompositeExecutor` | routes target prefixes such as `tool://` and `env://` |
| `ShardedExecutor` | stable FNV-1a routing of an action key to one executor shard |
| `DirectReasoner` | scripted decisions without a model |
| `CheckpointStore` | persistence contract for resumable run state |
| `InMemoryCheckpointStore` | process-local tests and development |
| `FileCheckpointStore` | append-only JSONL reference store |
| `SqliteCheckpointStore` | transactional single-host checkpoint storage |
| `LeaseStore` | mutual-exclusion contract for one live runner per agent |
| `InMemoryLeaseStore` | process-local lease implementation |
| `SqliteLeaseStore` | multi-process lease on one SQLite database |
| `retry`, `RetryPolicy` | bounded retries with backoff and jitter |
| `HumanBridge` | questions and action approvals |

## Decisions

A reasoner may return:

```text
plan | act | act-batch | need-context | wait-for-human | complete | fail
```

For `act-batch`, policy and approval run serially for each proposed action.
Authorized actions execute concurrently in one `ACTING` phase. Every result is
recorded and verified separately.

## Execution guarantees

- Every action crosses the required `PolicyEngine` before execution.
- Each action receives a deterministic default `idempotencyKey` based on run and
  iteration; external systems must still enforce idempotency.
- Per-action deadlines abort a child `AbortSignal`. Executors must honor the
  signal for cancellation to reach underlying work.
- Tool and environment failures become failed observations.
- Model usage attached to a decision emits `model.usage`; terminal events carry
  accumulated usage.
- `maxIterations` defaults to 64.
- Approval without a `HumanBridge` is denied.

Retries are intended for failures known to be safe to repeat. A timed-out write
may have reached the external system; reconcile it instead of assuming failure.

## Events

Use callbacks for simple subscribers:

```ts
const off = runner.on('*', (event) => render(event));
```

Or consume history plus live events as an async iterable:

```ts
for await (const event of runner.events()) {
  render(event);
}
```

The iterable closes on completion, failure, cancellation, or pause. Event data
is structured-cloned at emission, so later action or task mutation cannot
rewrite the journal. Subscriber exceptions are isolated in
`EventBus.deliveryErrors`.

## Checkpoint and resume

Checkpoints are written at reasoning boundaries and include:

- iteration;
- tasks and actions;
- observations and context;
- optional `StatefulReasoner` state;
- stable `runId`, next event sequence, and hash-chain head.

Resume restores the journal identity and calls `restoreState()` when the
reasoner implements `StatefulReasoner`.

```ts
const result = await new AgentRunner(deps).run({ resume: true });
```

Checkpointing provides at-least-once recovery, not rollback of an external
side effect. Use idempotency keys and authoritative reconciliation.

## Wake and session compaction

`wake()` is the journal-native resume: it rebuilds the session — tasks,
actions, observations, context, iteration — from events alone, via
`recoverSession`, and continues the same runId, sequence, and hash chain.
No checkpoint store required; any object with `history(filter)` works
(`SqliteEventStore`, `PgEventStore`, a parsed JSONL file).

```ts
const result = await new AgentRunner(deps).wake(eventStore, runId);
// or: run({ resume: true, journal: events })
```

`wake` refuses an empty journal for the agent rather than silently starting
fresh under a resumed identity. An interrupted reasoning iteration replays —
at-least-once, safe under the deterministic `runId:iter-N` idempotency key.

`runner.compact(summary)` is session compaction as a kernel operation: it
emits `session.compacted` (the summary is in the audit trail, not a prompt
trick) and collapses this runner's observations to the summary plus the
`keepObservations` most recent. `wake` applies the same collapse on rebuild.
The journal itself is never rewritten — the chain stays verifiable.

## Runner leases

Configure a lease when multiple processes could start the same agent:

```ts
lease: {
  store: new SqliteLeaseStore('.naro/runtime.db'),
  ttlMs: 30_000,
}
```

The runner acquires before work, heartbeats during the loop, and releases on
exit. A second live holder fails during initialization. If heartbeat reports a
lost lease, the runtime currently emits `replan.triggered`; it does not forcibly
stop the holder. High-impact targets still need fencing or idempotency.
`SqliteLeaseStore` coordinates processes sharing one host/database. A multi-host
deployment needs Redis, etcd, Postgres, or another shared implementation.

## Sharded execution

`ShardedExecutor` routes the same key—`action.target` by default—to the same
executor instance. This keeps tenant workspaces, browser sessions, or device
connections stable while distributing unrelated targets. Use `routedBy` when
your shard key differs from the target. Sharding is routing, not replication or
a distributed queue.

## Extension rules

- New target scheme: add an `ActionExecutor` route.
- New checkpoint backend: implement `CheckpointStore` and run its contract
  suite.
- New lease backend: implement `LeaseStore` with atomic acquire and fenced
  heartbeat semantics.
- New strategy: implement `Reasoner`; add `StatefulReasoner` when internal state
  must survive checkpoints.
