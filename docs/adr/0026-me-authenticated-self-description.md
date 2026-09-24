# 0026 — `GET /me`: authenticated self-description

Status: accepted
Date: 2026-02-10

## Context

PRD-006's requirement 7 is render-by-role: a principal without `admin`
never sees the System section rendered at all, and a `viewer`-only
principal sees a template's Runs tab with no composer. A UI cannot
honestly implement that without knowing the caller's identity and
effective roles — and no endpoint returned them. The alternatives are
all worse:

- Probing privileged endpoints and hiding on 403 — the UI issues writes
  it doesn't intend just to learn what it can't do; 403s leak into
  server logs as phantom attacks and the answer is route-shaped, not
  role-shaped.
- Encoding roles into the bearer token — tokens are opaque secrets, not
  a serialization format; reissuing them on every role change defeats
  the point of a store (ADR 0025).
- A role-switcher in the UI itself — exactly the "pretend to be someone
  else" surface requirement 7 exists to reject.

## Decision

`naro serve` gains `GET /me`, returning the authenticated caller's own
principal: `{id, roles, tenantId?}` with roles expanded to their
effective set (the same `expandRoles` the authorization check applies).
No new privilege: the response exposes only what the bearer token
already authorizes. On a server with no auth configured (dev default)
it returns `{id: 'anonymous', roles: [all], open: true}` so a UI can
render the unrestricted view and label it honestly.

The endpoint carries no role requirement of its own — any authenticated
principal can describe itself; it is not an admin surface.

## Alternatives considered

- **Fold it into `/health` or `/ready`.** Rejected: probes are
  unauthenticated by design (orchestrators can't carry credentials);
  identity doesn't belong on an auth-free route.
- **Return the principal inside every other response** (a header or
  envelope). Rejected: coupling identity to unrelated payloads makes
  caching and response shapes worse everywhere for a need that is
  once-per-page-load.

## Consequences

- UIs (the chat interface, the console, anything custom) can render
  role-accurate surfaces without probing or guessing — requirement 7
  becomes implementable as specified.
- The expanded role set is now observable to the caller — `operator`
  reads back `[viewer, operator]`, `admin` reads back all four. That's
  honest, not leaky: the caller is authorized for each of them.
- One more route to keep in the table, documented beside the role map
  in `cli/src/serve.ts`.
