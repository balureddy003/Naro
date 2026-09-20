# Naro Principles

The quality gate from the charter, as enforceable review rules. Every PR
should pass all of these.

## Universality
- *Would a non-coding agent use this?* If no → domain profile or application,
  not core.
- *Is the interface smaller than the implementation?* If no → redesign.
- *Does `core/` import anything beyond `node:` builtins?* It must not.

## Replaceability
- Every external technology behind an interface (`CheckpointStore`,
  `ContextProvider`, `ModelProvider`, `ToolSource`, `PolicyEngine`).
- No provider SDK types may leak into a public contract.
- Contract tests: replacement checkpoint, policy, exporter, and tool-source
  implementations run the shared suites from `@naro/contract-tests`.

## Observability
- *Is the state transition legal and emitted?* Transitions only via the
  runner, always through `assertTransition`, always an event.
- *Are actions and observations separate?* Intent vs evidence — never
  collapse them into "messages".
- *Can this run be reconstructed?* The ordered event log is the audit trail;
  replaying external side effects requires controlled adapters or fixtures.
- *Can consumers follow it live?* `runner.events()` provides history plus live
  events and closes at a stopped state.

## Reliability
- *Can this be cancelled?* `AbortSignal` honored at every boundary.
- *Can this be resumed?* Checkpoints at reasoning boundaries only.
- *Is it bounded?* `maxIterations` — no infinite agent loops.

## Security
- *Is this policy-controlled?* Every action passes `WAITING_FOR_PERMISSION`.
- *Could the model self-authorize?* It must not — decisions come from the
  policy engine, which the model cannot influence.
- *Are secrets in code?* Never. Providers read credentials from env/config.

## Evidence
- Completion is a claim until a verifier checks authoritative evidence.
- Prefer schemas, predicates, commands, sensors, or human review over an LLM
  judge; calibrate model judges before using them.
- Benchmarks run the real runtime and compare named cases with stored baselines.

## Domain safety
- Domain constraints live below the model: path jails, destination allowlists,
  SQL read/write classification, declared runbooks, workflow validation, and
  robotics estop latches.
- Profiles expose the smallest useful capability set and document which actions
  need grants or approval.

## Honesty
- No fake implementations. Test doubles are named (`MockModel`,
  `InMemoryAgentBus`) and their scope is documented.
- Failures are observations with `success: false` and `error` — the reasoner
  must be able to see reality.
- Documentation distinguishes an included reference implementation from a
  distributed or production guarantee.
