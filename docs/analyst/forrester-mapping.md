# Forrester Research Mapping: Naro

**Evidence-gated agent kernel**  
November 2026  
*Independent mapping of publicly described Forrester findings to Naro. Not a Forrester publication.*

---

## 1. Sources reviewed

| Report / Stream | Date | Public takeaway |
|-----------------|------|-----------------|
| The State of Agentic AI, 2026 | May 2026 | Technical viability reached; enterprises lack orchestration maturity, **executable governance**, and disciplined nonhuman identity |
| Agent Control Plane research stream | Announced Dec 2025 | Emerging category: inventory, govern, orchestrate, and assure heterogeneous agents |
| Forrester Wave: Agentic Development Security Tools, Q4 2026 | Q4 2026 | New category for governing coding agents and validating agent-generated software |
| Forrester Wave: AI Platforms, Q3 2026 | Aug 2026 | Platforms now evaluated on ability to execute enterprise processes via agents |
| Bot and Agent Trust Management Software Wave, Q2 2026 | Q2 2026 | Focus on inbound agent provenance, intent, and action controls |

## 2. Mapping: Forrester gaps → Naro mechanisms

| Forrester emphasis | Naro mechanism | Status |
|--------------------|----------------|--------|
| Executable governance (not just policy docs) | Required `PolicyEngine`; every action passes `WAITING_FOR_PERMISSION` | Shipped |
| Proof that outcomes were checked | Verification is a runtime state (`VERIFYING` → accept or `REPLANNING`) | Shipped |
| Machine-verifiable audit | Hash-chained journal + `buildEvidence` + `naro verify` | Shipped |
| Nonhuman identity / principal control | Approver identity journaled; grants; capability allowlists | Partial (principal field proposed in ADR 0017) |
| Provenance of triggering content | `Observation.trust` + policy rules that deny external-triggered actions | Shipped |
| Governance under existing harnesses | `@naro/adapter-harness` (Claude Agent SDK, OpenCode) | Shipped |
| Agent inventory across vendors | Not present | Gap |
| Enterprise-wide multi-agent orchestration plane | Multi-agent bus exists; no full control-plane inventory/orchestration | Partial |
| Customer evidence / reference deployments | None public | Gap |

## 3. Positioning relative to Forrester categories

### Agent Control Plane
Forrester describes an enterprise layer that inventories, governs, orchestrates, and assures agents across vendors.

**Naro supplies:**
- Runtime governance (policy gate)
- Assurance (verification state + evidence record)
- Per-run audit that can be verified offline

**Naro does not supply:**
- Cross-vendor agent inventory
- Centralized enterprise orchestration UI/plane
- Identity federation at enterprise scale

**Positioning:** Naro is a **kernel-level control and evidence layer** that can sit beneath or beside an Agent Control Plane, not a replacement for one.

### Agentic Development Security Tools
These tools focus on governing coding agents, scanning agent-generated code, and reducing risk in the development lifecycle.

**Naro relevance:**
- Can wrap coding harnesses via the harness adapter
- Provides the runtime authorization and post-action verification those tools often assume
- Journals the full policy → action → observation → verifier chain

**Positioning:** Complementary. Naro is the execution-time gate and proof layer; security tools remain the static/analysis layer.

### AI Platforms
Forrester’s AI Platforms Wave evaluates full platforms that build and run agentic applications.

**Positioning:** Naro is not competing in this Wave. It is infrastructure that platforms or custom systems can embed for governance and evidence.

## 4. Alignment with “State of Agentic AI, 2026”

Forrester’s core diagnosis:
> Companies are chasing agentic AI; few are catching it because of missing orchestration maturity, executable governance, and disciplined nonhuman identity.

Naro’s design directly targets the second and third items:
- Executable governance → required policy state
- Disciplined action control → grants, allowlists, provenance-aware denials, verification gate

Orchestration maturity is only partially addressed (durable journal + multi-agent primitives exist; full enterprise orchestration does not).

## 5. Gaps relative to Forrester expectations

| Expectation | Current Naro status |
|-------------|---------------------|
| Reference customers / production evidence | None public |
| Breadth of integrations (Python, major platforms) | TypeScript only; harness adapter for two coding tools |
| Enterprise identity & inventory | Not present |
| Published packages & adoption metrics | Packages unpublished by choice |
| Strategy / roadmap communication to market | Strong internal docs; limited external narrative |

These are the same execution gaps already noted in the internal market-quadrant assessment.

## 6. Suggested analyst narrative

> Naro is an open-source evidence-gated agent kernel that makes authorization and verification non-bypassable runtime states and produces a machine-verifiable evidence record for every run. It aligns with Forrester’s identified blockers to agentic AI scale (executable governance and assurance) and can serve as the runtime control layer beneath coding harnesses or custom agents. It is not an enterprise Agent Control Plane or an AI platform. Adoption and reference evidence remain early.

## 7. Related documents

- [Gartner-style briefing](gartner-briefing.md)
- [Market quadrant (self-assessed)](../market-quadrant.md)
- [Positioning](../positioning.md)
- [AI System Engineering Guide](../guide/README.md)
- [Production readiness](../production-readiness.md)

---

**Sources:** Public Forrester blog posts, report abstracts, and vendor announcements describing the above research (2025–2026). Full Wave reports are paywalled; this mapping uses only publicly stated findings.
