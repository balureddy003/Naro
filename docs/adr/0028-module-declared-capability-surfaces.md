# 0028 — Module-declared capability surfaces: run submission + model verification

Status: accepted
Date: 2026-09-25

## Context

PRD-006's chat UI surfaced a real gap in the `naro serve` module
contract: two backend capabilities existed in the runtime but could
never be reached through `serve`, because the module interface was only
`createRunner(goal)` — a constructor, no way back into the server.

1. **Delegation (multiagent).** `@naro/multiagent`'s `delegationTool`
   hands a child goal to an `AgentBus`. The bus handler inside a module
   could build and run a child `AgentRunner` itself — but that run would
   never register in serve's `RunRegistry` or `runs` map, so the child
   run was invisible to `GET /runs` and to the UI's trace grouping.
   `traceId` propagation existed all the way down (`ExecContext.traceId`
   → `naro:traceId` goal metadata → `runner.run({traceId})`); the missing
   seam was *submitting* a child goal through the same launch path that
   registers HTTP-submitted runs.

2. **Model verification.** `verifyOllamaCapabilities` (adapter-openai)
   proves what a local model actually does — the antidote to catalog
   marketing — but serve can't call it without knowing which providers a
   deployment uses, and serve must stay vendor-neutral (core rule:
   adapters translate, the control plane doesn't absorb vendor types).

The naive fixes both leak: accepting `traceId` on `POST /goals` lets any
caller forge trace membership; a built-in `/admin/models/verify` that
probes Ollama hardcodes a vendor into serve.

## Decision

Two module-declared capabilities, both opt-in and additive to the
existing contract:

- **`info.submit`** — `RunnerFactory`'s `info` gains a `submit` function:
  `submit(childGoal, { template }) → { runId, done }`. It runs the child
  through the *same* launch path as `POST /goals` — same registry upsert,
  same journal, same `runs` map, same caller principal (the child inherits
  the requesting principal's tenant scope; a delegate can't escape the
  parent's visibility). Trace inheritance is read off the child goal's
  `naro:traceId` metadata — serve reads the string key directly rather
  than importing `@naro/multiagent`, keeping the dependency one-way.
  The delegation tool awaits `done`, so the parent's action-completed
  observation carries the child's real result.

- **`modelVerifier`** — an optional module export (`ServeOptions
  .modelVerifier`) called by `POST /admin/models/verify`, admin-gated
  like every `/admin/*` route. The module owns which models exist and
  how they're probed (the demo maps it to `verifyOllamaCapabilities`;
  another deployment could map it to Bedrock or nothing). Unset → `501
  "module does not declare a model verifier"` — the UI renders that as
  an honest absent capability, never a fake result. Verification errors
  → `502`, so "endpoint down" and "capability absent" stay distinct.

The chat-demo module exercises both: `InMemoryAgentBus` serves a
read-only `vendor-researcher` child agent whose runs register under the
parent's trace, and `modelVerifier` probes the real Ollama endpoint —
declared only in non-mock mode, since a scripted `MockModel` has nothing
to verify.

## Consequences

- A delegated run is now a first-class run: it lists in `GET /runs`,
  groups under `?traceId=`, has its own journal + evidence record, and
  its own policy/approval gates. The UI's sidebar nests it under the
  parent; the run view links both directions.
- Modules can't escalate through `submit`: the child runs with the
  caller's principal, and its policy/verifier/budgets come from the
  module's own `createRunner` for the child template.
- `POST /goals` does **not** accept a caller-supplied `traceId` — trace
  membership is established only by the delegation path, where the
  parent's `ctx.traceId` is authoritative.
- `memory.written` still has no emitter — this ADR deliberately does not
  invent one; the demo surfaces memory as tool actions + a real behavior
  change (a repeated vendor answers without the gated lookup).
- Not addressed (known, future): `naro bench` results have no read path
  in serve; `EscalatingReasoner` doesn't emit a tier-escalation event —
  the UI shows replans but not "which tier answered".
