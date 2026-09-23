# 0022 — `naro serve` exposes an attributed cancel endpoint (the Article 14 stop button)

Status: proposed
Date: 2026-09-23

## Context

`AgentRunner`'s cancellation mechanism is real and already proven:
`docs/principles.md`'s Reliability rule ("Can this be cancelled?
`AbortSignal` honored at every boundary") is backed by code, not aspiration
— `cli/src/serve.ts`'s `RunRecord` carries a per-run `AbortController`, and
`close()` (server shutdown/drain) calls `rec.signal.abort('server shutting
down')` for every running run, producing a clean `agent.cancelled`
terminal event per run.

What doesn't exist is any way to reach that same, already-working
mechanism *without* shutting down the whole server. Reading the route
table in `startAgentServer`: `GET /health`, `/ready`, `/runs`,
`/runs/:id(/events|/evidence)`, `GET /approvals`, `POST /approvals/:id`,
`POST /goals` — no `POST /runs/:id/cancel`, no fleet-wide halt. An
operator who needs to stop one specific misbehaving run (not every run on
the process) has no path to do it short of restarting the server, which
cancels every other run too.

This is the EU AI Act's Article 14 requirement in its most literal form:
oversight personnel need "the ability to halt the system through a stop
button or comparable procedure" — and per-action `require_approval` (which
Naro already has, gating a *specific future* action) is not the same
capability as halting a run that is *already mid-execution* between
approval checkpoints. [docs/compliance/eu-ai-act-article-12.md](../compliance/eu-ai-act-article-12.md)
maps Article 12; this record is the natural Article 14 counterpart, found
by the same "read the actual route table" method rather than assumed.

## Decision

`naro serve` gains `POST /runs/:id/cancel` (role: `operator`, matching the
role already required for `POST /goals` — the same principal who can
start a run can stop one) and an optional `POST /runs/cancel-all`
(role: a new `admin`, distinct from `operator`, since fleet-wide halt is a
strictly larger blast radius than any single-run action). Both:

1. Call the existing `rec.signal.abort(reason)` — no new cancellation
   mechanism, the same path drain already uses.
2. Require a `reason` in the request body, stamped on the resulting
   `agent.cancelled` event's `data.reason` — already a field that event
   type supports (`core/src/events.ts`: `'agent.cancelled': { reason?:
   string; usage?: ModelUsage }`), just never populated by an operator
   action today.
3. Are attributed the same way ADR 0012 attributes approvals: the calling
   principal's id lands in the journal, not just in an HTTP access log —
   an `attributed` or `by`-shaped addition to the cancellation path
   analogous to `human.approval.received.by`.
4. Return `404` for an unknown or already-terminal run id, `202` (not
   `200`) for a successful cancel request — cancellation is requested,
   not instantaneous; the terminal event lands asynchronously the same
   way it already does at drain.

## Alternatives considered

- **Treat `require_approval` policy gates as sufficient "human
  oversight."** Rejected as the complete answer: a gate controls whether
  a *specific future* action proceeds. Article 14's stop-button
  requirement is about interrupting a run that's already past its last
  gate and mid-execution (a long-running action, a loop between gates) —
  a materially different capability that `require_approval` alone cannot
  provide.
- **Expose cancellation only via killing the process (current
  behavior).** Rejected: this is the actual gap — restarting the whole
  server to stop one run cancels every other tenant's run too, an
  unacceptable blast radius for exactly the deployment this capability is
  for (`naro serve` with multiple concurrent runs, per ADR 0013's
  multi-tenant visibility work).
- **A softer "pause" instead of cancel** (park the run in
  `WAITING_FOR_HUMAN`, resumable later, rather than terminating it).
  Considered as a *future* addition, not this decision: pausing needs a
  resumption story (who's allowed to resume, does the pause count against
  budgets) this record doesn't scope. Cancel-with-`agent.cancelled` is
  the smaller, immediately buildable capability that satisfies "halt the
  system" without also solving "and then what."
- **No attribution — cancellation is just an operational action, not
  evidence.** Rejected for the same reason ADR 0012 attributed approvals:
  "who stopped this run and why" is exactly the fact an auditor asks for
  after an incident: leaving it in an access log instead of the journal
  makes it unavailable to `naro verify`.

## Consequences

- Closes a real Article 14 gap without inventing new kernel machinery —
  `AgentRunner`'s `AbortSignal` handling and `agent.cancelled`'s existing
  `reason` field already do the work; this is a control-plane surface
  change, not a runtime one.
- `admin` becomes a fourth role alongside `viewer`/`operator`/`approver`
  (ADR 0012) — a deployment not configuring it simply has no principal
  who can fleet-wide-halt, which is a safe default (fail toward "no one
  can do the scarier thing" rather than granting it implicitly).
- The per-run cancel endpoint is the more commonly needed capability and
  ships first; fleet-wide halt is a smaller, optional addition on the
  same mechanism once the single-run path is proven.
- No change to `AgentRunner`'s public contract — this is entirely
  `cli/src/serve.ts` wiring an already-existing signal to a new,
  authenticated, attributed HTTP route.
