# 0012 — Control-plane identity: principals, approver attribution, policy identity

Status: accepted
Date: 2026-11-06

## Context

`naro serve` shipped with a single shared bearer token: it gated access but
carried no identity — a denied request and an approved one looked identical
in the journal, and nothing recorded *who* answered an approval or *which*
policy engine produced a verdict. An audit trail that cannot answer "who
approved this action, and under which policy" is an evidence hole, and both
facts existed only in the heads of operators.

Requests also had no deadline in storage: `pending()` returned every
unanswered row forever, and `respond()` would happily resolve a request whose
waiting runner had long since timed out — a zombie approval mutating a row
nobody was waiting on.

## Decision

Three additive identity surfaces, all journaled:

- **Principals on the control plane.** `ServeOptions.principals` maps bearer
  tokens to `{id, roles}`; roles are `viewer` (read runs and the approval
  queue), `operator` (submit goals), and `approver` (answer approvals), with
  operator/approver implying viewer. `--token` remains as shorthand for one
  admin principal. Wrong or missing credentials get 401; insufficient role
  gets `403 {error: 'forbidden', required: <role>}`.
- **Approver attribution end-to-end.** `POST /approvals/:id` resolves to the
  calling principal's id; `SqliteApprovalBridge` persists it as
  `answered_by` and returns it from `approve()` as `by`; the runner stamps
  `by` on `human.approval.received`. The journal — not just the approvals
  table — now records who approved.
- **Policy identity.** `PolicyEngine` gains an optional `id`, stamped on
  `permission.requested`, `action.permitted`, `action.denied`, and
  `human.approval.requested`. `buildEvidence` reads it back as
  `ActionEvidence.policyEngine`. Every shipped engine names itself
  (`tool-policy`, `rules`, `opa`; `allOf` composes member ids).
- **Approval expiry.** Requests carry `expires_at = created_at +
  timeoutMs`; `pending()` filters expired rows and `respond()` refuses
  them. Old databases gain the columns via `PRAGMA table_info` + `ALTER
  TABLE`, with pending rows backfilled to their original deadline.

## Alternatives considered

- **JWT/OIDC on the control plane.** Deferred: `naro serve` is designed to
  sit behind the organization's gateway (production-readiness §10 already
  assigns tenant authz to the deployment). A token-file map gives
  attribution without Naro re-implementing the org's identity stack; a JWT
  verifier can become a principal source later without changing the
  endpoint model.
- **Attribution only in the approvals table, not the journal.** Rejected:
  the evidence is the journal. If `answered_by` lived only in an
  operational SQLite table, `naro verify` on an exported journal could not
  say who approved a destructive action — the audit question this ADR
  exists to answer.
- **Per-request `by` decided by the bridge.** Rejected for HTTP: the bridge
  cannot see the caller's principal — identity enters at the control plane,
  so `respond(id, answer, by)` is the seam.

## Consequences

- The journal now answers "who approved this and under which policy" —
  `human.approval.received.by` plus `policy` on the gate events, surfaced
  in the evidence record as `approver`/`engine`.
- All changes are additive: old principals-free deployments behave exactly
  as before; old journal files lack `policy`/`by` and evidence simply omits
  them; old approvals databases are migrated in place.
- `respond()` on an expired request now fails — a caller racing the
  deadline sees `404 no pending request` instead of silently writing a row
  the runner will never read. That is the intended fail-closed behavior.
- Role implication is fixed in code (operator/approver imply viewer); a
  deployment wanting finer roles composes them in the file — roles the
  server doesn't know still authenticate, they just satisfy nothing.
