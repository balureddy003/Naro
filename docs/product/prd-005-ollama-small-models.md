# PRD-005 — Ollama Small Models as the Default Cheap Tier

Status: proposed
Owner: unassigned
Depends on: [PRD-001](prd-001-cost-aware-escalation.md), `@naro/adapter-openai`
Depended on by: [PRD-002](prd-002-outcome-templates.md) (default cheap-tier config), [PRD-003](prd-003-managed-control-plane.md) (self-hosted deployment option)

## Summary

A documented, benchmarked recipe for running `EscalatingReasoner`'s cheap
tier (PRD-001) against small open models served locally through
[Ollama](https://ollama.com), using the OpenAI-compatible transport
`@naro/adapter-openai` already implements. This is a documentation and
configuration deliverable, not new adapter code: `OpenAiCompatibleProvider`
already names Ollama as a supported target
(`adapters/openai/README.md`, `baseUrl: 'http://localhost:11434/v1'`).
What does not exist yet is a recommended model list, a verified capability
matrix per model, and a packaged default configuration a template author
can point at without doing this research themselves.

## Problem

PRD-001's cost story depends on the cheap tier actually being cheap and
actually being good enough to resolve most requests. "Cheap" is easy —
any smaller model is cheaper than a frontier one. The part nobody has
verified for Naro specifically is whether a small open model, run on
hardware the business already owns, clears the bar PRD-002's templates
need. Today an implementer wiring up `EscalatingReasoner`'s cheap tier has
to independently discover that Ollama works, pick a model from a
catalog of dozens with no guidance, and find out the hard way which
capabilities (tool-calling, structured output) that model actually
supports versus merely claims to. That research is exactly the kind of
work [docs/product/README.md](README.md) says a small business has no
capacity to do — and it shouldn't have to happen once per template
author, either.

Running the cheap tier locally also answers a question PRD-001 and
PRD-003 both leave open: for a business sensitive about sending customer
data (transaction descriptions, customer emails) to any third-party API
even for the "easy" cases, self-hosted small-model inference is the only
tier that touches nothing outside their own hardware. That is a real,
distinct value proposition from "cheaper," and this PRD is what makes it
concrete instead of aspirational.

## Goals

- Publish a short list of small models verified to work with
  `@naro/adapter-openai` against a local Ollama install, with their
  actual capability support (not the catalog's marketing claims) recorded
  per PRD-001 requirement 6's "degrade cleanly when a capability isn't
  there."
- Provide a default `EscalatingReasoner` cheap-tier configuration
  (`ollamaCheapTier(opts)` or equivalent) that PRD-002 templates can use
  without hand-assembling a `ModelProvider` + capability declaration
  themselves.
- Produce real benchmark numbers (via PRD-001's `BenchmarkRunner`
  acceptance methodology) for at least one PRD-002 template run against
  an Ollama-hosted model, not just against `MockModel` tiers.
- Document the zero-marginal-cost, data-never-leaves-the-business
  argument as an explicit, evidence-backed option for PRD-003's hosted
  offering and for a business that self-hosts `naro serve` entirely.

## Non-goals

- A new adapter package. `@naro/adapter-openai`'s `OpenAiCompatibleProvider`
  already speaks Ollama's OpenAI-compatible endpoint; building a
  dedicated `@naro/adapter-ollama` would duplicate an existing, working
  contract for no behavioral gain.
- Training, fine-tuning, or quantizing any model. This PRD picks and
  configures models that already exist in Ollama's public catalog; it
  does not modify their weights. That boundary is [docs/learn/01-training.md](../learn/01-training.md)'s,
  unchanged by this PRD.
- Managing Ollama itself (installation, model pulls, GPU/CPU sizing,
  upgrades) as Naro product surface. Ollama is a dependency a business or
  operator installs and runs; this PRD documents how to point Naro at it,
  not how to operate it. PRD-003 may eventually run Ollama as part of a
  hosted deployment's own infrastructure — that operational question
  belongs to PRD-003, not here.
- Picking one model as "the" default forever. Small-model quality moves
  fast; this PRD's model list is a snapshot to revisit, not a permanent
  commitment. See Risks.

## Candidate models

Names below are current Ollama catalog entries at time of writing,
listed for their weight class and license as public facts — every row's
Verified column must be filled from real capability testing against
`@naro/adapter-openai` (the invariant that adapter's own README states:
"no guessed capabilities") before it is used as a default, not assumed
from a model card.

| Model | Approx. size | Ollama tag | Chat | Tool-calling | Structured output | Verified? |
|---|---|---|---|---|---|---|
| Llama 3.2 | 1B / 3B | `llama3.2:1b`, `llama3.2:3b` | yes | claimed | claimed | no — needs testing |
| Qwen 2.5 | 0.5B–7B | `qwen2.5:1.5b`, `qwen2.5:3b`, `qwen2.5:7b` | yes | claimed | claimed | **yes — `qwen2.5:3b` verified 2026-02-08 via `verifyOllamaCapabilities`: all five capabilities proven (chat, tool-calling, structured-output, streaming, embeddings); a live `transaction-categorizer` run completed in ~2.2s at 834 tokens, $0 API cost. Other tags still need testing.** |
| Phi-3.5-mini | 3.8B | `phi3.5` | yes | claimed | claimed | no — needs testing |
| Gemma 2 | 2B / 9B | `gemma2:2b` | yes | no (base model has no native tool-calling) | claimed | no — needs testing |
| SmolLM2 | 135M–1.7B | `smollm2` | yes | no | no | no — needs testing |

The "Verified?" column is the actual deliverable of this PRD's first
milestone — the table above is a starting candidate list, not a claim
about what works. A model whose tool-calling is unverified must ship
with `capabilities: ['chat']` only (per `OpenAiCompatibleProvider`'s
documented default), which rules it out as a drop-in `ReActReasoner`
tier for any PRD-002 template needing tool use until verified otherwise.

## Functional requirements

1. **No new adapter code.** Configuration is
   `new OpenAiCompatibleProvider({ baseUrl: 'http://localhost:11434/v1', capabilities: [...] })`
   against a locally running `ollama serve`, exactly as
   `adapters/openai/README.md` already documents. This PRD adds
   documentation and a packaged default, not a new `ModelProvider`
   implementation.
2. **Capabilities are declared from verified test results, never from a
   model's marketing card.** Each row in the candidate table above is
   promoted from "claimed" to a specific `ModelCapability` list only
   after a real `chat`/tool-calling/structured-output round-trip against
   that exact Ollama tag passes `@naro/adapter-openai`'s own conformance
   expectations. This is the same invariant the adapter's README already
   states; this PRD is the first thing that actually exercises it against
   small models rather than frontier ones.
3. **A packaged default cheap-tier helper**, e.g.
   `ollamaCheapTier({ model, baseUrl? })` returning a ready-to-use
   `{ reasoner: ReActReasoner, label: string }` tier for
   `EscalatingReasoner`, so a PRD-002 template author writes one line
   instead of assembling `OpenAiCompatibleProvider` +
   `provider.getModel()` + `ReActReasoner` construction by hand. This is
   a thin convenience function, not a new abstraction — it composes
   exactly what `adapters/openai/README.md`'s usage example already
   shows.
4. **Embeddings, if a template needs retrieval, use the same transport.**
   `OpenAiCompatibleProvider`'s `embed()` already maps to `POST /embeddings`,
   which Ollama serves for embedding-capable models (e.g.
   `nomic-embed-text`). No separate embeddings PRD is needed — this is a
   configuration note, not new capability.
5. **Fallback behavior when Ollama is unreachable is explicit, not
   silent.** If the cheap tier's endpoint is down, `EscalatingReasoner`
   must surface a clear failure (existing `NaroError` propagation from
   `@naro/adapter-openai`, per its "errors surface" invariant) rather than
   hang or silently skip to the strong tier — an operator debugging "why
   did every request escalate today" needs the real answer ("Ollama was
   down"), not an indistinguishable cost spike.
6. **Documentation states hardware reality, not aspiration.** A README
   section covering realistic CPU/GPU throughput expectations for the
   verified model list (tokens/sec ranges, not benchmarks this PRD
   doesn't run) so a business or implementer can judge feasibility before
   trying it, consistent with [docs/documentation-style.md](../documentation-style.md)'s
   "no marketing adjectives without evidence."

## Success metrics

Using PRD-001's `BenchmarkRunner` acceptance methodology, on at least one
real PRD-002 template:

| Metric | Target for v1 acceptance |
|---|---|
| Verified capability match rate (claimed vs. actual, from the candidate table) | reported per model — this is diagnostic, not a pass/fail target |
| Task success rate (post-verification) using an Ollama-hosted cheap tier vs. a cloud-API cheap tier of similar size | no statistically significant regression |
| Cost per resolved outcome, Ollama cheap tier vs. always-frontier baseline | strictly lower — inherits PRD-001's requirement, with the Ollama tier's marginal cost counted as compute/electricity, not API spend, and disclosed as such |
| % of requests resolved on local hardware without escalating to a cloud tier | reported — this is the number that determines whether a business's data ever leaves their own infrastructure for the common case |

## Dependencies

- `@naro/adapter-openai` (`OpenAiCompatibleProvider`) — already implements
  the transport; no dependency change.
- `@naro/reasoning` (`EscalatingReasoner`, PRD-001) — this PRD supplies
  that reasoner's default cheap-tier configuration, it does not build the
  reasoner itself.
- `@naro/evaluation`'s `BenchmarkRunner` for the acceptance numbers.
- A locally reachable Ollama install for development, testing, and any
  business that adopts the self-hosted option — an external runtime
  dependency, not a Naro package.

## Risks and open questions

- **Small-model quality is a moving target.** The candidate list above
  will be outdated within months of publication; this PRD's model table
  needs an explicit revisit cadence (tied to a release, not "whenever
  someone notices"), or it will silently rot into wrong guidance — the
  exact failure mode requirement 2 exists to prevent.
- **Tool-calling reliability on small models is the real open question,
  not a formality.** Several candidates in the table above are chat-only
  in their base form; a template requiring tool use may need a
  larger-than-ideal "small" model to actually work, which cuts into the
  cost story PRD-001 promises. This PRD's first milestone (verification)
  is what turns that from a guess into a documented fact.
- **Hardware variance makes latency/throughput claims fragile.** A
  business running Ollama on a five-year-old office PC gets different
  numbers than one on a GPU workstation. Documentation must state ranges
  and the hardware they were measured on, not a single number implied to
  be universal.
- **Does PRD-003's hosted control plane run Ollama server-side, or is
  self-hosted Ollama only meaningful for the self-hosted `naro serve`
  deployment?** If the managed control plane also wants a local-inference
  tier, it needs its own compute provisioning story (GPU instances,
  cold-start latency) that this PRD does not solve — flagged for PRD-003
  to pick up explicitly rather than assume.
- **Licensing is per-model and must be checked, not assumed uniform.**
  Llama, Qwen, Gemma, and Phi ship under different licenses (some with
  use-based restrictions). A business relying on this PRD's
  recommendation needs the license implication stated per model in the
  final documentation, not left for them to discover.

## Milestones

1. Capability verification pass over the candidate table (real
   `chat`/tool-calling/structured-output tests against
   `@naro/adapter-openai`, each result recorded) — turns "claimed" into
   "verified" or rules a model out.
2. `ollamaCheapTier()` packaged default + documentation (setup, hardware
   expectations, license notes per verified model).
3. One real PRD-001/PRD-002 benchmark run using the verified cheap tier
   against a real template, producing real cost and success-rate numbers
   — not illustrative ones.
4. Revisit cadence documented (tied to a release cycle) so the model
   table has an owner and doesn't silently go stale.
