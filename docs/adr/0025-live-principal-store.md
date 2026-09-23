# 0025 — A live principal store, not a static token-file map

Status: proposed
Date: 2026-09-23

## Context

ADR 0012 gave `naro serve` real identity — `Principal {id, roles, tenantId?}`
— resolved from `ServeOptions.principals`, a bearer-token-to-identity map
the process reads once at startup. That ADR deferred anything more:
"`naro serve` is designed to sit behind the organization's gateway...
A token-file map gives attribution without Naro re-implementing the
org's identity stack." Correct for the buyer that ADR had in mind — a
team with an existing gateway and identity provider in front of the
control plane.

It's the wrong shape for the buyer PRD-006 is designed for: a small
business owner with no gateway, no IdP, and no one on staff who edits a
server's config file and restarts a process to add a teammate. Compare
the reference point PRD-006's Problem section already names — LibreChat,
a genuinely self-hosted, no-code chat product. LibreChat can offer
in-app "add a user, pick their role, done" because it has a database
backing that state; the app writes to it and reads it back on the next
request, no restart. `naro serve`'s principals today are structurally
incapable of that: they are parsed once, at process start, from
`ServeOptions.principals`, and nothing in `startAgentServer` re-reads
them.

This is the concrete gap PRD-006's setup wizard hit: an "invite your
team" step has nothing live to call — the only honest design available
without this record was "generate a config snippet, copy it into a file,
restart the server," which is not the no-code experience being asked
for and is not what LibreChat's own onboarding looks like.

## Decision

A new port, `PrincipalStore`, in the same shape `RunRegistry` and
`CheckpointStore` already establish for pluggable, durable control-plane
state:

```ts
interface PrincipalStore {
  get(token: string): Promise<Principal | undefined>;
  list(): Promise<readonly (Principal & { token: string })[]>;
  upsert(token: string, principal: Principal): Promise<void>;
  revoke(token: string): Promise<boolean>;
}
```

`ServeOptions` gains an optional `principalStore: PrincipalStore` —
additive, alongside (not replacing) the existing static `principals`
map and legacy `token` shorthand, which remain the right choice for the
gateway-fronted deployment ADR 0012 was written for. When a
`principalStore` is configured, `naro serve`'s auth check resolves a
bearer token through it on every request instead of the static map, so
a written change is live on the *next* request — no restart.

Three implementations ship, mirroring `RunRegistry`'s own tier:
`InMemoryPrincipalStore` (dev/tests), `SqlitePrincipalStore` (the
default for a genuinely self-hosted small-business deployment —
one file, no separate database to run), `PgPrincipalStore` (multi-host,
alongside the other Postgres-backed stores).

Three `admin`-gated endpoints, added to ADR 0024's admin surface rather
than a fourth separate record: `GET /admin/principals` (list, tokens
redacted to a last-4 display form — the store returns them for auth
lookups, the HTTP response does not echo secrets back), `POST
/admin/principals {roles, tenantId?}` (generates a new token
server-side, returns it once — the same "shown once" discipline as any
credential-issuance flow), `DELETE /admin/principals/:id` (revoke).

## Alternatives considered

- **JWT/OIDC, finally built now instead of deferred again.** Rejected
  for the same reason ADR 0012 deferred it: real OIDC is a bigger,
  differently-shaped project (an identity provider integration, token
  refresh, session management) that solves a problem this buyer doesn't
  have (no existing IdP to federate with). A durable store the admin UI
  writes to is the smaller, sufficient piece.
- **Store principals as rows in the same database as everything else
  (runs, events), no new port.** Rejected: `RunRegistry`/`CheckpointStore`/
  `EventStore` are already separate ports specifically so a deployment
  can choose different backing stores per concern (per
  [docs/architecture.md](../architecture.md)'s extension rules) — folding
  principals into an existing store's schema would couple two things
  that a deployment might reasonably want to scale or back up
  differently (a principals table changes rarely and holds secrets; an
  events table is high-volume and append-only).
- **Generated tokens are shown in the admin UI indefinitely, re-readable
  any time.** Rejected: a token that can be re-displayed is a token that
  can leak through a shoulder-surf or a screen-share long after issuance.
  Shown once, matching how every credential-issuance UX this pattern
  competes with (API keys, LibreChat's own tokens) already works.
- **Skip a store; keep file-based principals but add a CLI command to
  regenerate the file and hot-reload it via SIGHUP.** Considered: this
  would avoid a new port, but a hot-reloaded file is still a file an
  admin never touches directly *through the UI* — the wizard would need
  to shell out to write it, which means the browser-based admin UI needs
  filesystem access to the server host, a much larger privilege than an
  HTTP endpoint. Rejected as solving the restart problem while leaving
  the "no code" problem unsolved.

## Consequences

- Closes the concrete gap behind PRD-006's "invite your team" wizard
  step — it now calls three real endpoints instead of producing a config
  snippet for someone else to apply.
- `naro serve`'s auth path gains a per-request store lookup when
  `principalStore` is configured — a real latency/availability
  dependency that the static-map path never had (a store outage means
  auth checks fail, not "requests use last-known-good config"). Worth
  documenting in [docs/production-readiness.md](../production-readiness.md)
  once implemented.
- A deployment with no `principalStore` configured behaves exactly as
  before — this is purely additive, matching every other ADR this
  session that touched `ServeOptions`.
- Generated tokens need a real random-generation and hashing story
  (store a hash, not the raw token, mirroring how `SqliteApprovalBridge`
  and friends already handle sensitive fields) — flagged as an
  implementation requirement, not solved by this record's interface
  sketch alone.
