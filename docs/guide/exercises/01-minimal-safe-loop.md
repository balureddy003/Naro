# Exercise 1 — Minimal Safe Loop

## Goal

Build the smallest agent that still enforces authorization and verification.

## Steps

1. Define a single read-only tool (e.g., `get_time` or `echo`).
2. Implement a reasoner that always calls that tool then completes.
3. Insert a policy check that denies any unknown tool.
4. Add a verifier that accepts completion only if the observation matches an expected shape.
5. Emit a simple log of policy verdict, action, and observation.

## Expected artifacts

- Policy denial when an unknown tool is requested
- Verifier rejection when the observation is malformed
- A short trace you can re-read later

## Naro reference

Compare with:
- `examples/minimal-agent`
- `examples/governed-agent`

Key differences you should notice: verification is a state (not a hook), and the journal is hash-chained.
