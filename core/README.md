# @naro/core

The universal kernel. **Zero dependencies, zero domain knowledge.**

## What's inside

| Export | Contract |
|---|---|
| `Goal` / `createGoal` | what the agent is trying to accomplish — immutable |
| `Task` / `createTask` / `isTaskReady` | executable work; decomposition via `parentId`, ordering via `dependsOn` |
| `Action` / `createAction` | policy/execution unit with target URI, lifecycle, and idempotency key |
| `Observation` / `createObservation` | evidence produced by acting — never merged into "messages" |
| `AgentState`, `TRANSITIONS`, `assertTransition` | the 17-state lifecycle + its legal moves |
| `NaroEvent`, `EventDataMap` | immutable typed event union with `runId` and ordered `seq` |
| `Reasoner`, `StatefulReasoner`, `Decision`, `ReasoningContext` | closed decisions, action/evidence history, checkpointable strategy state |
| `ModelUsage` | optional token and cost accounting carried by decisions and events |
| `PolicyEngine`, `PolicyDecision` | `allow \| deny \| require_approval \| limit \| audit` |
| `ActionExecutor`, `ExecContext` | action → observation with goal, grants, cancellation, and secret resolution |
| `Verifier`, `Verification` | evidence-based success checks |
| `ContextProvider`, `ContextItem` | retrieval seam with provenance |
| `AgentSpec` | agent identity + goal (wiring lives in runtime) |

## Invariants

- **No imports beyond `node:` builtins.** If core needs a library, the design is wrong.
- **Every action passes the policy gate** — `REASONING → ACTING` is not in `TRANSITIONS`.
- **COMPLETED and CANCELLED are terminal.** FAILED is recoverable only via RECOVERING.
- **Everything optional is explicit**: missing capabilities throw, they don't degrade.
- **Parallelism stays governed**: `act-batch` authorizes each action before concurrent execution.
- **Secrets are references**: values resolve only at the execution boundary.

## Extending

New primitive? Ask: "would a robot controller AND a data agent both need
this?" Yes → core. No → an adapter package. Then add the contract test.
