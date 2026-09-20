# @naro/runtime

Deterministic, observable agent execution — the only place state transitions happen.

## What's inside

| Export | Role |
|---|---|
| `AgentRunner` | drives the loop; owns the state machine; emits everything |
| `EventBus` | ordered per-agent event log + typed subscriptions |
| `CompositeExecutor` | routes `tool://` / `env://` targets to executors |
| `DirectReasoner` | function → Decision; the baseline strategy |
| `retry`, `RetryPolicy` | backoff + jitter + `shouldRetry` for flaky calls |
| `withTimeout` | deadline for any promise |
| `CheckpointStore`, `InMemoryCheckpointStore`, `FileCheckpointStore` | pause/crash recovery |
| `HumanBridge` | approvals & questions in WAITING_FOR_HUMAN |

## The loop

```
CREATED → INITIALIZING → UNDERSTANDING → PLANNING → REASONING ─┐
   ▲   need-context → WAITING_FOR_CONTEXT ─────────────────────┤
   │   act → WAITING_FOR_PERMISSION → ACTING → OBSERVING        │
   │           (deny → obs)   (approval → WAITING_FOR_HUMAN)    │
   │         → VERIFYING → (fail → REPLANNING) ─────────────────┤
   └─── complete → VERIFYING → COMPLETED   /   fail → FAILED
```

Checkpoint after every cycle, abort check at every boundary.

## Key behaviors

- **Tool/env errors become observations**, not crashes — the reasoner sees
  reality and replans.
- **No `HumanBridge` + `require_approval` = denial.** Secure by default.
- **Resume** = `new AgentRunner(sameDeps).run({resume:true})` — restore from
  the store's latest checkpoint; the trail shows `agent.resumed`.

## Extending

- New executor schemes → register in `CompositeExecutor` routes.
- New checkpoint backend → implement `CheckpointStore` (3 methods).
- New reasoner → implement `Reasoner` in core; runner doesn't change.
