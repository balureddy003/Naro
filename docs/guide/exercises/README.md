# Exercises

Progressive exercises. Do them in order. Each one forces you to confront a production gap before showing the Naro reference.

## Level 1 — Minimal safe loop

1. Implement a tiny agent that can only call a single read-only tool.
2. Add a required policy check before the tool runs.
3. Add a verifier that rejects completion unless the tool observation matches an expected schema.
4. Compare your result with `examples/minimal-agent` and `examples/governed-agent`.

## Level 2 — Governance

1. Classify every tool as read / reversible / irreversible.
2. Make irreversible tools require human approval.
3. Record the approver identity.
4. Compare with the coding and governed examples.

## Level 3 — Evidence and audit

1. Emit a hash-chained log of every policy verdict, action, and observation.
2. Write a small verifier that recomputes the chain.
3. Compare with `naro verify` and the evidence record.

More levels (data contracts, cost budgets, multi-agent boundaries) will be added as the guide matures.
