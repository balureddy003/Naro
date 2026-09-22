# 0011 — Policy verdicts carry reasons

Status: accepted
Date: 2026-10-04

## Context

`PolicyEngine.evaluate` returned a bare `PolicyDecision` string. The
journal's `action.denied` event and the denial observation could only say
"denied by policy" — losing *why*: a missing grant, an external-triggered
side effect, and an unknown tool were indistinguishable in the evidence
record. A run's audit trail is the product; a reason-less deny is an
evidence hole.

## Decision

Engines may return `PolicyResult` — a bare `PolicyDecision` or a
`PolicyVerdict { decision, reason? }`. `toVerdict()` normalizes both.
Reasons are evidence: the runner puts them on `action.denied.reason`, in
the denial observation's `error` (`denied by policy: <reason>`), on
`human.approval.requested.question`, and the harness maps them to
`permissionDecisionReason`. `createToolPolicy` produces a reason per
branch (`no registered tool`, `missing grants`, `<effect> side effect
triggered by external evidence (sources)`, `<effect> side effect requires
approval`); `RulePolicyEngine` names the matching rule; the OPA adapter
accepts `{decision, reason}` documents.

## Alternatives considered

- **Reason only on deny.** Rejected: approvals benefit too — the human
  sees *why* the action needs sign-off, and the reason lands on
  `human.approval.requested` at no extra cost.
- **Structured error codes** (enumerated denial causes). Deferred:
  free-text reasons cover today's consumers; a coded taxonomy can layer
  on later without changing the verdict shape.

## Consequences

- Additive: bare `PolicyDecision` strings remain valid everywhere —
  `toVerdict` normalizes at every consumption site, so existing engines
  (including third-party ones) need no change.
- Denial observations distinguish causes; `formatEvidence` shows the
  reason inline (`denied (<reason>)`).
- Every consumer normalizes once — a verdict forgotten at a call site
  silently loses the reason, which is why consumption goes through
  `toVerdict` and not scattered `typeof` checks.
