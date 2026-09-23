---
"@naro/templates": minor
"@naro/adapter-openai": patch
---

New package `@naro/templates` — PRD-002 milestone 1. `OutcomeTemplate`
(the eight-part bundle: goal + tools + policy + verifier + budget +
tier config) and the first template, `transaction-categorizer`:
least-privilege read-only tools, membership + confidence-floor verifier
that drives `EscalatingReasoner` on failure. Proven offline end-to-end
with MockModel tiers — verified completion, out-of-set replan,
low-confidence escalation, hallucinated-tool denial.

`ollamaCheapTier` now also returns the `model`, since templates take
models and wire their own reasoners.
