# Analyst Briefing: Naro

**Evidence-gated agent kernel**  
Prepared for technical and market review · November 2026  
*This is an independent project briefing, not a Gartner publication.*

---

## 1. One-sentence positioning

Naro is an open-source agent runtime in which authorization and verification are mandatory states in the execution loop, and every run produces a hash-chained, machine-verifiable evidence record.

## 2. Problem it claims to solve

Industry analyses (including Gartner) project high cancellation rates for agentic AI projects. The dominant failure modes are operational rather than model-related:

- No structural enforcement of authorization
- Inability to prove outcomes after the fact
- Weak audit and provenance controls
- Lack of regression gates

Naro’s thesis: these must be runtime invariants, not optional middleware or prompt conventions.

## 3. What is actually unique (code-verified)

| Claim | Evidence in repo | Present in major alternatives? |
|-------|------------------|--------------------------------|
| Verification is a runtime state (rejection forces replan) | `AgentRunner` state machine, `VERIFYING` → `REPLANNING` | No — others treat it as a graph node or hook |
| Per-run cryptographic evidence record | Hash-chained journal + `buildEvidence` + `naro verify` | Partial (audit logs exist; outcome verdicts + chain verification do not) |
| Optional Ed25519 journal sealing | `journal.sealed` event + `naro verify --pubkey` | No |
| Kernel can govern foreign harnesses | `@naro/adapter-harness` (Claude Agent SDK, OpenCode) | No |
| Provenance as a first-class policy input | `Observation.trust` + `denyExternalTriggered` | Rare / prompt-level only |

## 4. Market placement (self-assessed)

| Axis | Score (1–5) | Rationale |
|------|-------------|-----------|
| Completeness of Vision | 4.7 | Structural governance, evidence, harness neutrality, brain/hands/session split |
| Ability to Execute | 1.4 | Unpublished packages, single maintainer, TypeScript-only, no reference production users |

**Quadrant position:** Visionary (high vision, low execution).  
Direction required: move up on execution (publish, reference users, broader language reach).

## 5. Buyer fit

**Strong fit**
- Teams that must demonstrate *why* an agent acted and *that* the outcome was checked
- Regulated or high-stakes environments (finance, infrastructure, healthcare ops)
- Organizations already using coding harnesses who want governance without replacing them

**Weak fit**
- Teams wanting a hosted platform or low-code agent builder
- Pure research / rapid prototyping with no audit requirement
- Python-primary shops (no Python runtime today)

## 6. Architecture summary

- 17-state machine with required `PolicyEngine`
- Strict separation of `Action` (intent) and `Observation` (evidence)
- Journal is the source of truth (`wake(runId)` rebuilds from journal)
- Domain profiles (coding, research, data, devops, browser, workflow, robotics)
- Model-neutral (OpenAI-compatible, Anthropic, Gemini + failover)

## 7. Risks and limitations (explicit)

- Single maintainer, v0.1.0, packages not yet on npm
- TypeScript / Node 24+ only
- No managed control plane or SLA
- Journal sealing moves trust to key custody (KMS/HSM still deployment-owned)
- Execution score will remain low until publication and reference users exist

## 8. Suggested analyst questions

1. Can verification truly not be skipped when a verifier is configured?
2. What is the exact evidence bundle an auditor receives today?
3. How does harness governance behave with Claude Agent SDK in practice?
4. What is the path from current state to a referenceable production deployment?
5. How does the project plan to address the execution gap (distribution, language, organization)?

## 9. Supporting materials in this repo

- [AI System Engineering Guide](../guide/README.md)
- [Market quadrant (full scoring)](../market-quadrant.md)
- [Positioning](../positioning.md)
- [Architecture](../architecture.md)
- [EU AI Act Article 12 mapping](../guide/compliance/eu-ai-act-article-12.md)
- [Production readiness](../production-readiness.md)

---

**Contact / next step:** Repository maintainer — issues and discussions on GitHub.  
Live demo path: `npm run example` and `npm run example:governed`.
