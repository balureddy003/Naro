# Minimal Safe Agent

The smallest composition that still enforces the core invariants.

## Capabilities

- One goal
- Small tool set (or none)
- Optional simple verifier (schema or predicate)

## Controls

- Required policy engine
- Unknown tools denied
- Verification state present

## Evidence

- Hash-chained journal
- Evidence record on completion

## Production boundary

Suitable for internal demos and low-risk automation. Not sufficient for irreversible actions or regulated domains without additional approval and retention controls.

See the runnable example: `examples/minimal-agent` and `examples/governed-agent`.
