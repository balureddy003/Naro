# Closing the Forrester & Gartner Gaps

**12-month execution roadmap**  
November 2026  
*Addresses the execution gaps identified in the [Forrester mapping](forrester-mapping.md) and [Gartner-style briefing](gartner-briefing.md).*

---

## Gap summary

| Gap | Source | Current | Target (12 months) |
|-----|--------|---------|---------------------|
| Packages unpublished | Both | 0.1.0, not on npm | Published `@naro/*` packages with changelog |
| No reference production evidence | Both | None public | 1–2 documented reference deployments or public case studies |
| TypeScript-only / limited language reach | Both | Node 24+ only | Python client for HTTP environments + harness hooks |
| Enterprise identity & inventory | Forrester | Partial (approver identity) | Principal as policy input (ADR 0017) + basic agent registry |
| Agent inventory across vendors | Forrester | None | Lightweight inventory of governed runs/agents |
| Limited external narrative | Forrester | Strong internal docs | Public roadmap, clearer README positioning, analyst docs linked |
| Single maintainer / organization | Gartner | Bus factor 1 | Contribution paths + at least one external contributor on core |

## Phase 1 — Distribution & narrative (0–3 months)

**Goal:** Make Naro installable and the strategy externally visible.

| Action | Owner | Done when |
|--------|-------|-----------|
| Publish core packages to npm (`@naro/core`, `@naro/runtime`, `@naro/cli`) | Maintainer | `npm install @naro/cli` works |
| Add root `ROADMAP.md` summarizing this document | Maintainer | Linked from README |
| Link analyst briefings from README and docs index | Maintainer | Visible on first page |
| Create 5 “good first issue” tickets (docs, examples, tests) | Maintainer | Labeled and open |
| Write one public “why evidence-gated” post or thread | Maintainer | Shared on X/LinkedIn |

**Exit:** Packages resolve; external narrative exists; contribution entry points are visible.

## Phase 2 — Language reach & identity (3–6 months)

**Goal:** Widen the door beyond TypeScript and strengthen nonhuman identity.

| Action | Owner | Done when |
|--------|-------|-----------|
| Python client for `serveEnvironment` / `HttpEnvironment` | Community or maintainer | `pip install naro-client` can drive a remote environment |
| Implement ADR 0017 (delegated principal as policy input) | Maintainer | `PolicyContext.principal` exists and is journaled |
| Basic agent/run registry API (`GET /agents`, `GET /runs` already partial) | Maintainer | Inventory of governed agents queryable |
| Harness adapter example for one additional tool (e.g. Codex or Cursor if hooks exist) | Community | Documented working example |

**Exit:** Python path exists; principal is a first-class policy input; basic inventory available.

## Phase 3 — Reference evidence & hardening (6–12 months)

**Goal:** Produce the customer/evidence artifacts analysts expect.

| Action | Owner | Done when |
|--------|-------|-----------|
| One documented reference deployment (even internal/dogfood with redacted evidence bundle) | Maintainer + early user | Public case study or evidence sample in repo |
| Journal retention & export workflow documented and tested | Maintainer | Runbook + sample export |
| At least one external contributor with merged core or adapter PR | Community | Visible in contributors |
| Optional: KMS-backed sealing example | Maintainer | Documented integration pattern |

**Exit:** At least one public reference artifact; identity and inventory gaps reduced; bus factor improved.

## What this does *not* claim

- Naro will not become a full enterprise Agent Control Plane or hosted AI platform in 12 months.
- Publishing and reference users require maintainer action and external adoption; this roadmap makes the path explicit.
- Scores on Ability to Execute will only move after the Phase 1 and Phase 3 artifacts exist.

## Tracking

Progress against this roadmap will be updated in:
- This document (status column)
- Root `ROADMAP.md`
- Release notes / changelog when packages publish

## Related

- [Forrester mapping](forrester-mapping.md)
- [Gartner-style briefing](gartner-briefing.md)
- [Market quadrant](../market-quadrant.md)
- [Enterprise / regulated buyer docs](../enterprise/README.md)
