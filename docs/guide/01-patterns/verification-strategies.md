# Verification Strategies

Verification turns a completion claim into accepted evidence. Choose the strategy that matches the risk and the nature of the outcome.

## Decision matrix

| Outcome type | Preferred verifier | Fallback | Notes |
|--------------|--------------------|----------|-------|
| Structured data (JSON, SQL result, file) | Schema + predicate | Command | Deterministic, fast, cheap |
| Side effect in external system | Command or human | Schema on returned payload | Prefer real system check over model judgment |
| Open-ended text / research | Predicate + optional LLM-judge | Human | Calibrate the judge; never sole authority for high-stakes |
| Irreversible or regulated action | Human | Composite (schema + human) | Record approver identity in the journal |
| Multi-step goal | Composite | Per-action + final | Reject any step → replan |

## Implementation notes (Naro)

- Verification is a runtime state (`VERIFYING`). Rejection moves to `REPLANNING` and surfaces an observation to the reasoner.
- Verifiers: schema, predicate, command, human, composite, calibrated LLM-judge.
- Evidence record joins policy verdict → action → observation → verifier verdict.
- `naro verify` recomputes the hash chain and checks the evidence record.

## Anti-patterns

- No verifier configured (completion is trusted by default).
- LLM-as-judge as the only check for irreversible actions.
- Verification that only inspects the model’s final message instead of the actual observation.

See also: [Verification Gap](../03-production-gaps/verification-gap.md).
