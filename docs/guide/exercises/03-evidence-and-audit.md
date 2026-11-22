# Exercise 3 — Evidence and Audit

## Goal

Produce a tamper-evident record that lets you reconstruct and verify a run after the fact.

## Steps

1. Assign every event a sequence number and a hash of (previous hash + event payload).
2. On completion, write the full chain to a file.
3. Write a small verifier that recomputes the chain and reports success or the first mismatch.
4. Optionally sign the final hash.
5. Join policy verdict + action + observation + verifier result into one evidence record per action.

## Expected artifacts

- A file that fails verification if any line is edited
- An evidence record you can show an auditor

## Naro reference

- Hash-chained journal (`prev` / `hash`)
- `naro verify`
- `buildEvidence`
- Optional Ed25519 sealing

See the runtime journal and verification packages.
