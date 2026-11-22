# Exercise 2 — Governance and Approval

## Goal

Make irreversible actions require explicit human approval and record who approved them.

## Steps

1. Classify your tools: read-only / reversible / irreversible.
2. Change the policy so irreversible tools return `require_approval`.
3. Implement a simple approval bridge (console input or a queue).
4. Record the approver identity with the approval event.
5. Confirm that a denied or timed-out approval becomes an observation the reasoner can see.

## Expected artifacts

- Run that pauses for approval
- Journal (or log) entry containing the approver
- Clean denial path

## Naro reference

- Policy `require_approval`
- `HumanBridge` and durable approval stores
- Approver identity on `human.approval.received`

See `examples/governed-agent` and `examples/coding-agent`.
