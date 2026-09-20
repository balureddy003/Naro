# Naro Principles

The quality gate from the charter, as enforceable review rules. Every PR
should pass all of these.

## Universality
- *Would a non-coding agent use this?* If no → adapter, not core.
- *Is the interface smaller than the implementation?* If no → redesign.
- *Does `core/` import anything beyond `node:` builtins?* It must not.

## Replaceability
- Every external technology behind an interface (`CheckpointStore`,
  `ContextProvider`, `ModelProvider`, `ToolSource`, `PolicyEngine`).
- No provider SDK types may leak into a public contract.
- Contract tests: any implementation of a port passes the same suite.

## Observability
- *Is the state transition legal and emitted?* Transitions only via the
  runner, always through `assertTransition`, always an event.
- *Are actions and observations separate?* Intent vs evidence — never
  collapse them into "messages".
- *Can this run be replayed?* The event log is the audit trail.

## Reliability
- *Can this be cancelled?* `AbortSignal` honored at every boundary.
- *Can this be resumed?* Checkpoints at reasoning boundaries only.
- *Is it bounded?* `maxIterations` — no infinite agent loops.

## Security
- *Is this policy-controlled?* Every action passes `WAITING_FOR_PERMISSION`.
- *Could the model self-authorize?* It must not — decisions come from the
  policy engine, which the model cannot influence.
- *Are secrets in code?* Never. Providers read credentials from env/config.

## Honesty
- No fake implementations. A stub is named a stub (`MockModel`,
  `DirectReasoner`) and documented as one.
- Failures are observations with `success: false` and `error` — the
  reasoner must be able to see reality.
