# Naro for Small Business — Product Layer

*Explanation.* What this directory is, how it relates to the kernel, and
which parts are built versus proposed.

## Relationship to the kernel

Naro's kernel ([docs/positioning.md](../positioning.md),
[docs/architecture.md](../architecture.md)) is the evidence-gated agent
runtime: policy before action, verification before completion, a
tamper-evident proof of what happened. That identity does not change here.

The documents in this directory describe a **product layer built on the
kernel**, aimed at a specific buyer the kernel alone does not serve: a
small business that cannot self-host a TypeScript runtime, cannot afford a
surprise token bill, and has no compliance team to catch a wrong answer.
Nothing here redefines what `@naro/core` or `@naro/runtime` are. Where a
PRD needs new kernel surface, it says so explicitly and points to an ADR
([docs/adr/README.md](../adr/README.md)) — most of what follows does not.

## Why small business, specifically

A small business adopting AI today faces four problems an enterprise can
absorb and a five-person company cannot:

1. **Cost unpredictability.** One verbose agent run against a frontier
   model can turn a $50/month tool into a four-figure bill.
2. **No way to verify output.** No compliance team exists to catch a wrong
   invoice total or a fabricated customer reply before it reaches someone.
3. **No capacity to build anything.** No one on staff can wire up a RAG
   pipeline or a routing strategy.
4. **Lock-in risk.** A workflow built around one vendor's proprietary
   agent platform has no leverage when that vendor changes pricing.

Naro's already-shipped differentiators — verification as a runtime state,
an evidence trail, any model behind one contract — answer three of these
four directly. They were not built for this buyer, but they fit. The gap
is cost predictability, which is what PRD-001 closes.

## Documents

| Doc | Phase | Status | Depends on |
|---|---|---|---|
| [PRD-001](prd-001-cost-aware-escalation.md) — Cost-Aware Escalation | 1 | proposed | [ADR 0014](../adr/0014-cost-aware-escalation-is-a-reasoner.md) |
| [PRD-002](prd-002-outcome-templates.md) — Outcome Templates Library | 2 | proposed | PRD-001 |
| [PRD-003](prd-003-managed-control-plane.md) — Managed Control Plane | 3 | proposed | PRD-002, `naro serve`, `@naro/client` |
| [PRD-004](prd-004-smb-integrations.md) — SMB Integrations | 4 | proposed | PRD-002 |
| [PRD-005](prd-005-ollama-small-models.md) — Ollama Small Models | 1 | proposed | PRD-001, `@naro/adapter-openai` |

"Proposed" means written and reviewable, not committed to a timeline —
none of this has a team assigned or a ship date. Phase 5 (optional,
data-justified fine-tuning) has no PRD yet; it is out of scope until
Phase 1–4 produce enough production trace volume to justify it, per the
roadmap discussion this directory originates from.

## What is explicitly out of scope

No model registry, no distillation pipeline, no quantization framework, no
energy-per-outcome telemetry as a product surface. A small business owner
does not read a joules-per-outcome dashboard. They read a bill and a
result. Every PRD in this directory is written against that constraint.
