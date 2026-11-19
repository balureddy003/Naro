---
"@naro/cli": minor
"@naro/chat-ui": minor
---

ADR 0027 (accepted): hosted email/password signup for PRD-003's managed
control plane, layered on ADR 0025's `PrincipalStore` rather than a
second identity system — a signed-up account is provisioned as a real
principal the moment it exists.

- `naro serve --accounts-store <file.db>` turns on `POST
  /accounts/signup`, `POST /accounts/login`, `POST /accounts/logout` and
  session-cookie auth (httpOnly, SameSite=Lax, `--secure-cookies` to add
  `Secure` once behind TLS). Off entirely unless configured — no
  self-hosted deployment gets new routes it didn't ask for.
- New `cli/src/accounts.ts`: `hashPassword`/`verifyPassword` (scrypt,
  random per-account salt, timing-safe compare), `AccountStore` +
  `SessionStore` ports with `InMemory`/`Sqlite` implementations, and a
  per-server-instance `LoginRateLimiter` (5 attempts / 5 min per
  email+IP).
- `PrincipalStore` (ADR 0025) gains one additive method, `getById(id)` —
  a session resolves by principal id, not by bearer token, and needs the
  same immediate-revocation guarantee `get(token)` already gives.
- `@naro/chat-ui` gains a real signup/login screen (email + password, a
  Sign up/Log in tab toggle, inline validation) shown instead of the
  token-paste screen whenever the server reports `accountsEnabled` —
  plus a sign-out control in the sidebar for both auth modes. The
  self-hosted token-paste screen (also redesigned this pass: real
  typography, an icon set replacing unicode glyphs, a restrained shadow
  system) is unchanged in its own architecture — still no self-service
  registration there, by design.

Login timing is constant whether or not the email is registered
(verified against a dummy hash either way) so response time alone can't
be used to enumerate accounts. Signup/login/logout endpoints and the
rate limiter are covered by dedicated tests
(`cli/src/accounts.test.ts`, `cli/src/serve-accounts.test.ts`),
including a regression guard for a per-server-instance rate-limiter
bug caught before it shipped.
