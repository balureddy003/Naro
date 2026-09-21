# 0008 — Environments are reachable over HTTP

Status: accepted
Date: 2026-09-29

## Context

Brain / hands / session separates the model loop from the world it acts on.
For that separation to be real, an environment must be able to live in a
different process, container, or host than the runner — and be replaced when
it dies, without the runner noticing more than a failed observation.

`Environment` already *is* an `ActionExecutor`, so the contract is the right
shape; it was only reachable in-process.

## Decision

`serveEnvironment(env, opts)` exposes any `Environment` over HTTP
(`POST /execute`, `GET /state`, `GET /health`); `HttpEnvironment` is the
client implementing the same `Environment` contract. Both live in
`@naro/environment` on `node:http` — no new dependencies.

The wire carries the `Action` plus identity context (`agentId`, `goalId`,
`goal`, `grants`). It never carries `signal` or resolved `secrets`: abort
propagation stops at the transport (the remote action runs to completion —
same honesty boundary as timeouts elsewhere), and secrets resolve where they
are used, per the secrets rules in `production-readiness.md`. An optional
shared bearer token gates the endpoint; real authn/z and TLS remain a
deployment concern.

## Alternatives considered

- **gRPC / MCP as the transport.** Rejected for now: adds a protocol
  dependency to a package that today depends only on `@naro/core`. The port
  is `Environment` — a gRPC adapter can implement it later without touching
  the runner. MCP serves tools to *models*; this transports *actions*.
- **Streaming/WebSocket for abort propagation.** Deferred: real abort across
  the wire needs a session protocol, not a request/response. Documented as a
  boundary rather than faked.
- **Auto-discovering remote capabilities.** Deferred: `HttpEnvironment` takes
  `capabilities` in its constructor; a `/capabilities` endpoint is a trivial
  later addition.

## Consequences

- Hands can be scaled, restarted, or swapped independently of the brain;
  a dead remote surfaces as a failed observation, not a crashed run.
- The transport is intentionally thin — load balancing, mTLS, and network
  policy belong to the deployment.
- Abort does not cross the wire; remote side effects are at-least-once and
  must be reconciled by idempotency keys, same as local timeouts.
