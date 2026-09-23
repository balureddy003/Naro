# benchmarks — @naro/templates

`node templates/bench/categorizer.ts [--limit N]` — runs the
transaction-categorizer template over `fixtures.ts`'s 48 labeled SMB
transactions through the real `BenchmarkRunner` (same event stream the
audit log reads — no separate measurement path).

## Method

- Model: whatever `OLLAMA_URL`/`OLLAMA_MODEL` point at, capabilities from
  `verifyOllamaCapabilities()` — never assumed (PRD-005 rule)
- Each case runs the full pipeline: policy gate → tool calls →
  verification → (replan/escalate as needed)
- Check: extracted `category` must equal the fixture label (the verifier
  only gates set membership — this measures *correctness*, not just
  pass-through)

## Result — qwen2.5:3b, Ollama on Apple Silicon, 2026-02-08

| Metric | Value |
|---|---|
| Accuracy | **37/48 (77.1%)** |
| Wall time | 91.8s for 48 cases (~1.9s/case) |
| Tokens | 41,244 in / 2,535 out / 43,779 total |
| API cost (Ollama) | **$0.00** (marginal; compute/electricity excluded) |
| Same tokens at frontier list rates* | $0.1618 |

*Configurable via `FRONTIER_IN_PRICE`/`FRONTIER_OUT_PRICE` ($/1Mtok;
defaults are Claude-Sonnet-class list prices, labeled as such — not a
live frontier run).

## What the misses teach

Of 11 misses, ~7 are genuinely debatable boundary labels (VISTAPRINT→
Professional Services vs Marketing; MAILCHIMP→Software vs Marketing;
AMAZON→Software vs Office Supplies; QUICKBOOKS PAYROLL→Software vs
Professional Services) — a human bookkeeper could argue either way.
~4 are clear misses (ZOOM→Equipment, APPLE STORE→Utilities).

Two honest conclusions:

1. **Membership verification is necessary but not sufficient.** Every
   miss passed the verifier — the answer was *in* the allowed set, just
   *wrong*. PRD-002's own risk statement, now quantified: the verifier
   prevents garbage, not misjudgment. The `confidence` floor didn't fire
   either — the model self-reports 0.85–1.0 on wrong answers, so
   self-reported confidence is a weak escalation signal.
2. **The replan path works.** 8 verification failures replanned and
   converged (e.g. t38 took 7 iterations and landed correctly) — the
   verifier does catch *unverifiable* answers (prose, missing fields).

For a business: 77% hands-off with a visible evidence record per run is a
defensible v1 — every answer is journaled, so the ~23% needing review is
*findable*, which is the actual trust property. Improving the label
boundary accuracy is a strong-tier/escalation question, not a verifier
question.
