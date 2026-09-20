# @naro/core

The universal kernel. **Zero dependencies, zero domain knowledge.**

## What's inside

| Export | Contract |
|---|---|
| `Goal` / `createGoal` | what the agent is trying to accomplish — immutable |
| `Task` / `createTask` / `isTaskReady` | executable work; decomposition via `parentId`, ordering via `dependsOn` |
| `Action` / `createAction` | an attempt to change the world — `target` URIs, `state` lifecycle |
| `Observation` / `createObservation` | evidence produced by acting — never merged into "messages" |
| `AgentState`, `TRANSITIONS`, `assertTransition` | the 18-state lifecycle + its legal moves |
| `NaroEvent`, `EventDataMap` | typed event union — the audit vocabulary |
| `Reasoner`, `Decision`, `ReasoningContext` | the reasoning seam — closed decision union |
| `PolicyEngine`, `PolicyDecision` | `allow \| deny \| require_approval` |
| `ActionExecutor`, `ExecContext` | anything that turns an Action into an Observation |
| `Verifier`, `Verification` | evidence-based success checks |
| `ContextProvider`, `ContextItem` | Phase-6 context seam with provenance |
| `AgentSpec` | agent identity + goal (wiring lives in runtime) |

## Invariants

- **No imports beyond `node:` builtins.** If core needs a library, the design is wrong.
- **Every action passes the policy gate** — `REASONING → ACTING` is not in `TRANSITIONS`.
- **COMPLETED and CANCELLED are terminal.** FAILED is recoverable only via RECOVERING.
- **Everything optional is explicit**: missing capabilities throw, they don't degrade.

## Extending

New primitive? Ask: "would a robot controller AND a data agent both need
this?" Yes → core. No → an adapter package. Then add the contract test.
