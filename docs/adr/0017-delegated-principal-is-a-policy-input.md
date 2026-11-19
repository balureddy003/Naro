# 0017 — Delegated principal identity is a policy input

Status: accepted
Date: 2026-09-23

## Context

ADR 0012 gave `naro serve` real identity: a `Principal {id, roles, tenantId?}`
authenticates each HTTP call, and the journal now records *who* approved an
action and *which* policy engine decided. But that identity stops at the
control-plane boundary. Reading `core/src/policy.ts`: `PolicyContext` carries
`agentId`, `goal`, `grants`, and `provenance` — no `principal`. Once a goal
is submitted, every `PolicyEngine.evaluate()` call for the rest of that run
sees the same flat `grants` list, with no way to express "this specific
action is happening on behalf of principal X" versus "the service account
this deployment runs as." A rule can gate on *what* an agent is allowed to
do; it cannot gate on *whose authority* a given action is being taken under
— the two are different questions, and only the first has a policy input
today.

This gap has a name and a market outside Naro now. Cross App Access (XAA),
adopted in 2026 as the Enterprise-Managed Authorization extension to MCP's
own OAuth 2.1 authorization spec, and Microsoft Entra Agent ID (general
availability, 2026) both exist to answer exactly this question for agents
generally: "how does an agent prove who it is acting for, as it moves
between applications." Naro does not need to implement OAuth or become an
identity provider to have an opinion here — ADR 0012 already declined that
scope deliberately ("`naro serve` is designed to sit behind the
organization's gateway"). What Naro is missing is narrower: a place in
`PolicyContext` for the identity a gateway or control plane already
established to actually reach the gate, the same way `ctx.provenance`
already lets *evidence* origin reach it (ADR 0010).

## Decision

`PolicyContext` gains an optional `principal?: { id: string; roles?:
readonly string[]; tenantId?: string }` — the same shape ADR 0012 already
defined for `naro serve`'s `Principal`, not a new identity model. `AgentDeps`
gains an optional `principal` field; when set, the runner includes it on
every `PolicyContext` passed to `evaluate()`, exactly as `provenance` is
included today. `naro serve`'s `POST /goals` sets it from the authenticated
caller, so every action taken during that run carries "acting on behalf of
principal X" all the way to the policy gate, not just at goal submission.

A rule can now express what neither `grants` nor `provenance` can:
`deny` when `ctx.principal?.tenantId !== expectedTenant`, or
`require_approval` when `ctx.principal?.roles` doesn't include `operator`
for a specific action class, even though the agent's own `grants` would
otherwise allow it. This is additive: `principal` is `undefined` for every
existing single-tenant, no-identity deployment, and no shipped policy
changes behavior without being configured to read the new field.

## Alternatives considered

- **Implement OAuth 2.1 / XAA token issuance and verification inside
  Naro.** Rejected, for the same reason ADR 0012 deferred JWT/OIDC: that is
  the organization's identity stack, not the kernel's job — Naro's
  contribution is giving whatever identity the gateway already resolved a
  seat at the policy table, not becoming a second identity provider.
- **Fold principal into `grants` as prefixed strings** (e.g.
  `'principal:alice'`). Rejected: `grants` answers "what can this agent
  do," a flat capability list by design; overloading it to also answer
  "who is this for" makes every existing rule that inspects `grants` need
  to filter out identity strings it wasn't written to expect.
- **Scope this to `naro serve` only, as a control-plane-side filter before
  a goal is even submitted (reject the goal outright if the principal
  lacks some role).** Rejected as the *only* mechanism: that only gates
  goal submission, not the individual actions inside an approved run — a
  viewer-turned-operator's later action still needs its own per-action
  answer to "who is this for," which only `PolicyContext` reaching every
  `evaluate()` call provides.
- **Derive principal from `ctx.provenance` (treat the submitting caller as
  just another trust source).** Rejected: provenance answers "how
  trustworthy is this evidence," a question about content; principal
  answers "under whose authority," a question about authorization. ADR
  0010 kept trust levels narrow for the same reason this ADR keeps
  `principal` a separate field rather than a fourth trust level.

## Consequences

- Closes the gap between ADR 0012 (identity exists at the HTTP boundary)
  and ADR 0013 (identity scopes run *visibility*) — this is the missing
  third piece: identity as an input to *authorization decisions made
  during* a run, not just before or after one.
- A future adapter that calls out through `McpToolSource` to a downstream
  MCP server requiring XAA-style delegated auth now has something to key
  off: `ctx.principal` tells a `SecretProvider`/credential-selection layer
  *whose* delegated token to present, rather than one blanket service
  credential for every run regardless of who triggered it. Building that
  credential-selection adapter is not part of this decision — it becomes
  possible once `principal` exists as a policy input, and is real,
  unscoped follow-up work.
- `naro serve`'s `AgentDeps` construction path changes to thread the
  authenticated principal through to the runner — a small, additive
  change to `cli/src/serve.ts`, not a new subsystem.
- Every policy engine that wants to use this must be written to read
  `ctx.principal` explicitly; existing engines (`tool-policy`, `rules`,
  `opa`) continue to ignore it and behave exactly as before until updated.
