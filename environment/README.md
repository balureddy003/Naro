# @naro/environment

The generalized "world" — the abstraction that turns Naro into a coding
agent, a browser agent, or a robot controller without core changes.

## What's inside

| Export | Role |
|---|---|
| `Environment` | `id` + `capabilities` + `state()` + `execute(action) → Observation` (extends `ActionExecutor`) |
| `EnvironmentState` | observable snapshot — `resources` is domain-shaped |
| `InMemoryEnvironment` | key-value world: `env.get`/`env.set`/`env.delete`/`env.list` |
| `HttpEnvironment` | client: an `Environment` whose `execute`/`state` run over HTTP |
| `serveEnvironment` | server: expose any `Environment` at `POST /execute`, `GET /state` |

Remote transport lets hands run in a separate process, container, or host —
the runner sees the same contract either way. The wire carries the action
plus identity context; `signal` and resolved secrets never cross it, so a
remote action runs to completion once started (at-least-once — reconcile via
idempotency keys). `token` adds a shared-bearer gate; TLS and real authn/z
belong to the deployment. See
[ADR 0008](../docs/adr/0008-environments-are-reachable-over-http.md).

## The idea

A coding agent's workspace is files+git+terminal; a browser agent's is
tabs+DOM; a robot's is actuators+sensors. All are: *state you can observe,
capabilities you can invoke, changes you can verify* — one contract.

Domain environments (CodingEnvironment, BrowserEnvironment…) are adapters
implementing this interface; `core` never learns what a file is.

## Writing an environment

- Declare `capabilities` honestly — callers check before acting.
- `execute` returns observations, never throws across the boundary.
- `state()` is the agent's view — expose what's observable, no more.
- Keep an internal change log (like `InMemoryEnvironment.changes()`) —
  verifiers need evidence.
