# 0027 — Hosted account signup, layered on the existing `PrincipalStore`

Status: accepted
Date: 2026-09-24

## Context

PRD-006's chat UI (ADR 0025) is invite-only by design: an admin issues a
bearer token from `POST /admin/principals`, there is no self-registration,
matching the self-hosted `naro serve` model ADR 0012 established — the
person who starts the process is the deployment, there is no multi-tenant
workspace to sign up into.

PRD-003 ("Managed Control Plane") is the PRD where self-registration
actually belongs: a hosted, multi-tenant version of `naro serve` where a
business genuinely does sign up for an account, the way they'd sign up
for Stripe or Linear. PRD-003's own milestone 3 already names this
("Self-service signup + business-facing UI") and its Non-goals are
explicit that this doesn't need a from-scratch identity system —
"the existing `--principals` role model is likely sufficient for v1."

This record designs that signup against exactly that constraint: reuse
`PrincipalStore` (ADR 0025) as the identity backend a signed-up account
resolves into, rather than inventing a second, parallel identity system
alongside it. Two ways to authenticate (bearer token, session cookie)
converging on one `Principal` type is a smaller, more honest surface than
two identity models that both claim to answer "who is this."

## Decision

**A new port, `AccountStore`**, in the same shape/tiering convention
`PrincipalStore` established:

```ts
interface AccountStore {
  create(email: string, passwordHash: string): Promise<{ id: string; tenantId: string }>;
  findByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string; tenantId: string } | undefined>;
}
```

Signup (`POST /accounts/signup {email, password}`) does three things as
one unit: hashes the password (`node:crypto.scrypt`, a random 16-byte
salt per account, N=16384/r=8/p=1 — Node's own recommended defaults,
verified with `crypto.timingSafeEqual`, never a plain `===` on secret
material), creates the account with a fresh `tenantId`, and — this is
the layering decision — calls the existing `PrincipalStore.upsert()`
to provision that same person as `{id: accountId, roles: ['admin'],
tenantId}`. **The account IS a principal from the moment it exists.**
No separate "workspace" concept, no second admin bootstrap step — signup
*is* the bootstrap ADR 0025's own docs flagged as something a real
product needs.

**Sessions, not tokens, for this login path.** A session is a random
32-byte id (`crypto.randomBytes`, `naro_sess_` prefixed) stored server-
side in a new `SessionStore` (same InMemory/Sqlite tiering), mapping to
`{accountId, principalId, tenantId, expiresAt}`. The browser gets it as
an `httpOnly; secure; sameSite=lax` cookie — never readable by page
script, never the copy-paste-a-token flow ADR 0025's Access tab still
uses for invited teammates (that flow is unchanged; this is additive).
`naro serve`'s existing auth check gains a third resolution path
alongside the static map and `PrincipalStore`: a valid session cookie
resolves to the same `Principal` shape everything else already expects,
so `GET /me`, role checks, and every existing route work unmodified.

**`PrincipalStore` gains one additive method, `getById(id)`.** A session
stores `principalId`, not a bearer token, so resolving it needs lookup by
id — and needs the *same* immediacy `get(token)` already gives: a role
change or revocation must be visible on a session's very next request,
not after up to 30 days of TTL. Per ADR README's own convention, ADR
0025's text isn't edited after acceptance; this is a superseding,
additive extension to its interface, not a rewrite of its decision.

**Opt-in, not default.** `ServeOptions.accountStore`/`.sessionStore`
are additive fields, wired from a new `--accounts-store <file.db>` CLI
flag. A deployment that doesn't pass it — every self-hosted deployment
today — never has `/accounts/*` routes exposed at all (they 404, not
501, since exposing "signup exists but is disabled" is its own
information leak for a tool whose whole point is minimizing surface).
This is PRD-003's hosted product opting in, not a change to what PRD-006
ships for self-hosted users.

**Rate limiting on both `/accounts/login` and `/accounts/signup`.** Login
gets a per-email+IP sliding window (5 attempts / 5 minutes) — blunts
credential-stuffing against one account without limiting anyone else's
attempts. Signup gets a separate, IP-only window (5 / hour) — there's no
existing account to key it to, so this bounds mass account creation
instead. Both are documented honestly, matching this repo's existing
`dogfood/README.md` convention for scoped security claims: in-process,
per-replica, reset on restart — a real deployment behind multiple
replicas needs a shared store (Redis/Postgres) for this to hold under
horizontal scaling, flagged as follow-on work, not silently assumed
solved. A password over 256 characters is rejected outright, on both
routes, before it would ever reach scrypt — not a meaningful length in
practice, just cheap insurance against hashing an attacker-supplied
multi-kilobyte string on every request within the existing 64 KiB body
cap. `/accounts/signup`'s 409 on a duplicate email is a deliberate,
asymmetric choice from `/accounts/login`'s enumeration-resistant design:
telling a visitor "you already have an account" on signup is standard,
expected UX (Stripe and Linear both do it); hiding *which* emails are
registered matters specifically on login, where the response is
answering "did this password work," not "does this account exist."

**What is explicitly not in this record:** email verification and
password-reset-via-email both need a transactional email provider this
repo has no integration for. An account is active immediately on
signup (the same "usable right away" posture Stripe and Linear both
have — verification, where they do it, happens asynchronously, it
doesn't block first use). Building either honestly needs its own ADR
once an email adapter exists; faking a "check your inbox" screen that
sends nothing would be exactly the kind of implied capability this
project's documentation discipline exists to prevent.

## Alternatives considered

- **A separate `Account`/`Workspace` identity model, independent of
  `Principal`.** Rejected: doubles the identity surface every future
  feature (role checks, tenant scoping, admin endpoints) would need to
  reason about two ways to be "an admin." `PrincipalStore` already does
  everything a signed-up account needs once it exists; the only new
  thing signup adds is *how one gets created* and *how a browser proves
  it's still that person* (a session, not a re-typed token every visit).
- **JWT session tokens instead of server-side `SessionStore`.** Rejected
  for the same reason ADR 0025 chose a store over a self-encoding
  credential for principals: a JWT can't be revoked without a denylist
  (which is a store anyway, just an uglier one), and "sign out
  everywhere" is a one-row delete against a real `SessionStore`, not a
  key-rotation event.
- **OAuth (Google/Microsoft sign-in) instead of password auth.**
  Deferred, not rejected: it's the better long-run answer for a business
  buyer (no password to leak, delegates hygiene to a real IdP) but needs
  an OAuth app registration and consent-screen review per provider
  before it ships — real calendar time this record doesn't want to gate
  a first, working signup path on. Password + scrypt is the honest
  minimum that ships now; OAuth is a follow-on record once a provider
  partnership exists, the same sequencing PRD-004 already applies to its
  own OAuth connectors.
- **Reusing the bearer-token flow for signup** (generate a token, show
  it once, ask the person to paste it back in). Rejected as the thing
  this record exists to fix: a business owner signing up for a hosted
  product should never see the word "token" or "bearer" — that vocabulary
  is correct for the self-hosted admin-invites-a-teammate flow (ADR
  0025) and wrong for a first-time hosted signup.

## Consequences

- `naro serve` gains three new routes (`POST /accounts/signup`, `POST
  /accounts/login`, `POST /accounts/logout`) and a third auth-resolution
  path, all inert unless `--accounts-store` is configured.
- The chat UI (`@naro/chat-ui`) gains a second sign-in surface (email +
  password, styled as a real signup/login pair) alongside the existing
  token-paste screen, switched by a config flag the server injects — a
  self-hosted deployment never sees the accounts UI; a hosted one never
  sees the raw-token UI.
- Password storage, session cookie flags, and login rate-limiting become
  real security surface this repo now owns and must keep correct — the
  scrypt parameters, cookie flags, and rate-limit window are implementation
  details worth a security-review pass whenever they change, not a
  "write once, forget" primitive.
- Email verification and password reset remain explicitly unbuilt until
  an email-sending adapter exists — PRD-003's milestone 3 is not fully
  "self-service" until at least password reset ships; this record closes
  signup, not the whole account-recovery story.
- `AccountStore`/`SessionStore` follow `PrincipalStore`'s InMemory/Sqlite
  tiering for now; a `PgAccountStore`/`PgSessionStore` pair is the same
  follow-on work every other Pg-backed store in this repo already went
  through, deferred until PRD-003 needs multi-host durability.
