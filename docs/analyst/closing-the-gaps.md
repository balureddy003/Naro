# Closing the Forrester & Gartner Gaps

**12-month execution roadmap**  
November 2026  
*Addresses the execution gaps identified in the [Forrester mapping](forrester-mapping.md) and [Gartner-style briefing](gartner-briefing.md).*

**Independent progress (this pass):**
- Public narrative: [Why evidence-gated](../blog/why-evidence-gated.md) + root `ROADMAP.md`
- Language reach starter: [Python HTTP environment client](../../clients/python/)
- ADR 0017 (principal as policy input) already shipped in core/runtime

---

## Gap summary

| Gap | Source | Current | Target (12 months) | Status |
|-----|--------|---------|---------------------|--------|
| Packages unpublished | Both | 0.1.0, not on npm | Published `@naro/*` packages | Blocked on maintainer (npm token) |
| No reference production evidence | Both | None public | 1–2 documented references | Needs early user / dogfood |
| TypeScript-only / limited language reach | Both | Node 24+ only | Python client for HTTP environments | **Starter shipped** (`clients/python`) |
| Enterprise identity & inventory | Forrester | Partial | Principal as policy input + basic registry | **Principal shipped** (ADR 0017); inventory partial |
| Agent inventory across vendors | Forrester | None | Lightweight inventory | Partial (`GET /runs` exists) |
| Limited external narrative | Forrester | Strong internal docs | Public roadmap + posts | **Improved** (roadmap + blog post) |
| Single maintainer / organization | Gartner | Bus factor 1 | Contribution paths | Docs ready; issues still to open |

## Phase 1 — Distribution & narrative (0–3 months)

| Action | Owner | Status |
|--------|-------|--------|
| Publish core packages to npm | Maintainer | Pending (requires npm credentials) |
| Add root `ROADMAP.md` | — | Done |
| Link analyst briefings from README | — | Done |
| Create 5 good-first-issue tickets | Maintainer | Ready to open (templates in this doc / CONTRIBUTING) |
| Public “why evidence-gated” post | — | Done — [docs/blog/why-evidence-gated.md](../blog/why-evidence-gated.md) |

## Phase 2 — Language reach & identity (3–6 months)

| Action | Owner | Status |
|--------|-------|--------|
| Python client for remote environments | — | **Starter done** — `clients/python` |
| ADR 0017 principal as policy input | — | **Already shipped** |
| Basic agent/run registry | — | Partial (`GET /runs` on serve) |
| Additional harness adapter example | Community | Open |

## Phase 3 — Reference evidence & hardening (6–12 months)

Unchanged — requires reference users and operational decisions.

## Related

- [Forrester mapping](forrester-mapping.md)
- [Gartner-style briefing](gartner-briefing.md)
- [Why evidence-gated](../blog/why-evidence-gated.md)
- [Python client](../../clients/python/)
