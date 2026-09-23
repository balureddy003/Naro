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

Also ships `invoice-extractor` (PRD-002 milestone 3): get_document +
compute_total tools, and a verifier that parses the model's JSON claim,
checks it against the invoice schema, and reconciles line items → total
(a parse-first wrapper, since a schema check on the raw string is a
false negative). Verified live against qwen2.5:3b on Ollama: completed
in ~10s at ~980 tokens, $0.

Plus `bench/categorizer.ts` — a real benchmark over 48 labeled fixtures
through `BenchmarkRunner`. First numbers (qwen2.5:3b, Ollama): 77.1%
accuracy, ~1.9s/case, $0 API vs ~$0.16 at frontier list rates. Method and
miss analysis in `templates/bench/README.md`.
