# 0024 — Admin API surface for registry resolution and retention

Status: accepted
Date: 2026-09-23

## Context

Three real, already-accepted capabilities exist only as library methods,
reachable from code that embeds Naro directly, not from `naro serve`'s
HTTP surface:

- `ToolRegistry.resolve(name, sourceId)` and `.collisions()` (ADR 0020) —
  an operator decision on a cross-source tool-name collision.
- `ToolRegistry.acknowledgeDefinition(name, sourceId?)` (ADR 0016) — an
  operator decision on a changed remote tool definition (a possible rug
  pull).
- `PrunableEventStore.prune(runId, throughSeq, opts)` (ADR 0018) —
  attested retention pruning, today invoked via a `naro prune` CLI
  command against a store an operator has direct access to.

All three are exactly the kind of decision ADR 0012's `approver` role and
ADR 0022's `admin` role already exist for: something a human with
elevated trust must explicitly decide, attributed in the journal or
registry event log. None of them reach an operator running `naro serve`
as a remote service rather than an embedded library — which is the
deployment shape [docs/enterprise/prd-001-mcp-trust-and-delegated-identity.md](../enterprise/prd-001-mcp-trust-and-delegated-identity.md)
and [PRD-006](../product/prd-006-chat-interface.md)'s admin-facing
counterpart both assume.

This gap surfaced concretely while designing PRD-006's admin view: an
admin-only UI control for "resolve this tool collision" has nothing to
call over HTTP today. Rather than let the UI imply an endpoint that
doesn't exist, this record specifies the endpoints first.

## Decision

`naro serve` gains three `admin`-gated endpoints, reusing ADR 0022's
role (no new role) and its attribution pattern (calling principal's `id`
recorded, not just logged):

1. `GET /admin/tool-collisions` — lists `ToolRegistry.collisions()`
   verbatim; `POST /admin/tool-collisions/resolve {name, sourceId}` —
   calls `registry.resolve(name, sourceId)`, `404` if nothing pending
   for that pair.
2. `GET /admin/tool-definitions/changed` — lists tools with a pending
   `changedDefs` entry (ADR 0016); `POST /admin/tool-definitions/acknowledge
   {name, sourceId?}` — calls `registry.acknowledgeDefinition(name,
   sourceId)`, `404` if nothing pending.
3. `POST /admin/runs/:id/prune {throughSeq, policy?}` — calls the
   configured `PrunableEventStore.prune(runId, throughSeq, {policy,
   sealKey})` if the server was started with one; `501` if the
   deployment's store doesn't implement `PrunableEventStore` (an
   in-memory or non-prunable store), `400` if `planPrune`'s own
   validation throws (non-terminal run, bad cutoff).

Every write endpoint requires a request body naming *why* — `resolve`
implicitly records which source won by the call itself; `acknowledge`
and `prune` both already require `policy`-shaped justification per their
own ADRs. None of the three needs a new event type: `tool.collision.detected`/
`tool.definition.changed` (registry events, ADR 0016/0020) and
`journal.retention.pruned` (ADR 0018) already exist — these endpoints
are HTTP wiring onto decisions the kernel already knows how to record,
not new decisions.

## Alternatives considered

- **Require these operations stay CLI/embedded-only, never exposed over
  `naro serve`.** Rejected as the permanent answer: it's the correct
  default *today* (ADR 0018 shipped `naro prune` as a CLI command
  deliberately), but a deployment running `naro serve` as its only
  interface to the kernel has no other path to these decisions — an
  admin would need shell access to the host, which is a larger privilege
  than the `admin` role ADR 0022 already scoped for exactly this class
  of action.
- **One generic `/admin/registry` endpoint taking an arbitrary action
  name.** Rejected: an untyped dispatch endpoint hides what operations
  exist behind a string parameter instead of the route table itself —
  every other admin-adjacent surface in this codebase (`/runs/:id/cancel`,
  `/runs/cancel-all`) is a named route per decision, not a generic
  command channel.
- **Fold collision/definition resolution into the existing `/approvals`
  queue** (treat a pending collision as an `ApprovalRequest`). Rejected:
  `ApprovalRequest` is scoped to `HumanBridge`'s per-run, per-action
  approval flow (`require_approval` policy verdicts); a tool collision is
  a registry-level, cross-run concern with no `Action`/`runId` to attach
  an approval to. Reusing the shape would force a fake action id onto
  something that isn't one.

## Consequences

- `naro serve`'s `ServeOptions` gains an optional `registry: ToolRegistry`
  and reuses its existing optional `journal`/durable-store wiring for the
  prune endpoint — additive, no change for deployments that don't pass
  one (all three endpoints 404/501 rather than existing in a broken
  half-state).
- This is the first `naro serve` surface that mutates registry/store
  state directly rather than going through `AgentRunner`'s gate — by
  design: these are operator decisions *about* the gate's data (which
  tool definition to trust, how far back the journal is retained), not
  actions a goal is requesting. `PolicyEngine`/`WAITING_FOR_PERMISSION`
  don't apply because no `Action` is in flight; the `admin` role check at
  the HTTP layer is the entire authorization boundary for these three
  routes, and must be treated with the same care as a database
  credential, not a convenience flag.
- PRD-006's admin view (and any other admin UI) now has real endpoints
  to call instead of implying ones that don't exist — see the updated
  mockup and PRD-006's Interface design section.
