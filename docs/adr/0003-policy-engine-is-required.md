# 0003 — `AgentRunner.policy` is required; the model cannot self-authorize

Status: accepted
Date: 2026-09-20

## Context

A framework that defaults to "allow everything" is easy to start with and easy
to ship by accident. Every agent incident report of the last two years has the
same shape: a capability the operator did not know the agent had, exercised in
a way nobody authorized.

The state table already had no `REASONING → ACTING` edge; every action passed
`WAITING_FOR_PERMISSION`. The question was whether the gate could be empty.

## Decision

`AgentDeps.policy` is a required field. There is no implicit default. A
development composition passes `allowAllPolicy` from `@naro/core` explicitly,
and the documentation style guide forbids showing it without a
development-only warning. `createToolPolicy()` fails closed on tool names that
are not registered. The reasoner produces a `Decision`; it has no API for
changing runtime state or invoking an executor directly.

Enforced by the `AgentDeps` type and by `gate()` in `runtime/src/runner.ts`,
which evaluates policy for every action, including each member of an
`act-batch`.

## Alternatives considered

- **Optional policy, default allow.** Rejected: the failure mode is silent.
- **Optional policy, default deny.** Rejected: a default-deny agent that does
  nothing looks like a bug, and developers "fix" it by allowing everything.
  Requiring an explicit choice forces the decision into code review.
- **Policy inside tools (each tool checks its own permissions).** Rejected: a
  tool author can forget; a tool can be called through a path that skips the
  check; and cross-cutting rules (rate limits, approval for destructive side
  effects) do not belong to one tool.

## Consequences

- Every example, scaffold, and tutorial includes a policy line.
- `PolicyDecision` has four verdicts (`allow`, `deny`, `require_approval`,
  plus limit/audit variants in `@naro/policy`); approvals route through
  `WAITING_FOR_HUMAN` and back to the gate.
- Denials are observations, so a denied reasoner can choose another path.
- Composing engines (`allOf`, OPA adapter) is the way to cover non-tool
  schemes; `createToolPolicy`'s `otherwise: 'allow'` means "not mine", and
  the production checklist says so.
