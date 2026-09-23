# Market quadrant — agent runtimes and kernels (Sept 2026)

An analyst-style evaluation of where Naro sits, written in the Magic Quadrant
idiom: two fixed axes, a scored field, a position, and a direction vector.
It is deliberately harsh on Naro where the facts are harsh. Scores are
1–5, evidence-based on public releases and this repository's code as of
this document. This is our own assessment, not a Gartner publication.

## Axes

**X — Completeness of Vision.** Does the vendor understand where agent
infrastructure is going, and is the architecture built for it? Criteria:

| Criterion | Weight | What "5" means |
|---|---|---|
| Runtime-enforced governance | 25% | Policy, verification, and audit are structural — below the model, cannot be skipped |
| Evidence & auditability | 20% | Per-run proof: tamper-evident, attributable, machine-verifiable |
| Brain/hands/session decoupling | 20% | Stateless resume from an external journal; environments over the network |
| Model / harness neutrality | 15% | Runs any model; runs *beneath* third-party harnesses |
| Gen-AI pattern coverage | 10% | ReAct, plan-execute, reflection, RAG, memory, caching, eval, HITL |
| Domain reach | 10% | Coding, data, browser, devops, research, workflow, robotics |

**Y — Ability to Execute.** Can a buyer adopt it today and depend on it?

| Criterion | Weight | What "5" means |
|---|---|---|
| Distribution & adoption | 30% | Published, widely downloaded, referenceable production users |
| Production hardening | 20% | Durability, leases, drain, probes, multi-host proven |
| Ecosystem & integrations | 15% | Providers, MCP/A2A, observability, deploy artifacts |
| Developer experience | 15% | Time-to-first-agent, docs, examples, CLI |
| Organization & viability | 10% | Team size, funding, release cadence |
| Language reach | 10% | Python + TypeScript (the market is Python-majority) |

## Scored field

| Vendor | Category | Vision (X) | Execute (Y) |
|---|---|---|---|
| LangGraph (LangChain) | Orchestration | 3.6 | **4.8** |
| Mastra | Orchestration (TS) | 3.3 | 4.0 |
| CrewAI | Orchestration | 2.7 | 4.1 |
| OpenAI Agents SDK | Lab harness/SDK | 3.2 | 4.5 |
| Google ADK | Lab harness/SDK | 3.4 | 4.3 |
| Microsoft Agent Framework | Enterprise orchestration | 3.5 | 4.2 |
| Claude Agent SDK | Lab harness/SDK | 3.0 | 4.4 |
| Pydantic AI | Typed orchestration | 3.1 | 3.7 |
| agent-kernel / Bastion / Weaver | Security kernels | 3.4 | 1.6 |
| **Naro** | **Evidence-gated kernel** | **4.7** | **1.4** |

Vision scoring notes — where Naro earns its X: runtime-enforced governance 5
(policy required, `VERIFYING` is a state), evidence 5 (hash chain + Ed25519
seal + `naro verify`), decoupling 5 (`wake(runId)`, HTTP environments),
neutrality 5 (harness adapter beneath Claude/OpenCode), patterns 5 (all
present, including provenance as a policy input — ADR 0010, shipped since
the previous version of this review), domains 4. Nobody else scores above 3
on the first three criteria: orchestration frameworks let you *build*
verification; kernels gate but never check outcomes; lab SDKs are
single-vendor.

Execute scoring notes — where Naro loses its Y: distribution 0 (packages
unpublished, by choice — see the direction vector; `naro init` scaffolds
to a 404 until then), hardening 3 (Postgres ports, leases, drain, probes,
a durable run registry, journal, and now approval queue all exist — the
control plane has no remaining SQLite-only piece, but nothing here is
distributed *across* Postgres itself), ecosystem 3, DX 3 (deep docs, but the
end-to-end path broke at step one before this review), organization 1
(single author, v0.1.0), language 1 (TypeScript only, Node 24+).

## The quadrant

```
  Ability to Execute
  5 ┤                                    LangGraph ●
    │                        OpenAI SDK ●    ● Claude SDK
    │                          ● Google ADK
  4 ┤             CrewAI ●   ● MS Agent Fw
    │                 ● Mastra
    │                      ● Pydantic AI
  3 ┤
    │      CHALLENGERS                  LEADERS
    ├──────────────────────────────────────────────────
    │      NICHE PLAYERS                VISIONARIES
  2 ┤
    │                        ● agent-kernel / Bastion
    │                                              Naro ●  ⟶ ⬈
  1 ┤
    │
  0 ┼────────┬────────┬────────┬────────┬────────┬────
    0        1        2        3        4        5
                                    Completeness of Vision →
```

**Naro: Visionary, bottom-right.** Highest vision score in the field, lowest
execution. This is the classic position of an architecture that is right
before it is real.

## Uniqueness — what only Naro has

Four properties, each verified in code, none present in any other entrant:

1. **Verification is a runtime state, not a callback.** A `complete`
   decision is a claim; the kernel enters `VERIFYING` and a failed check
   forces `REPLANNING`. Competitors can build this as a graph node; Naro
   cannot *not* do it when a verifier is configured.
2. **A run produces proof.** Every event hash-chained; the terminal event is
   an Ed25519 signature over the head; `naro verify --pubkey` recomputes
   the chain, checks the seal, and prints policy → action → observation →
   verifier per action. Security kernels have audit logs; none have
   outcome verdicts in them, and none sign.
3. **The kernel runs beneath someone else's harness.** `@naro/adapter-harness`
   maps Claude Agent SDK / OpenCode tool hooks into the same policy gate
   and journal — "keep your harness, add governance." No orchestration
   framework can do this; every lab SDK is the harness being governed.
4. **The UI can't show anything the verifier disagrees with.**
   `cli/src/console.ts` renders `client.getEvidence(runId)` —
   `@naro/client`'s wrapper over the same `buildEvidence()` correlation
   `naro verify --json` prints. LangSmith, Langfuse, and every mainstream
   agent-observability UI query a separate telemetry pipeline that
   *describes* a run and can drift from it; Naro's console has no such
   second code path — see [ADR 0023](adr/0023-console-renders-the-evidence-record-not-a-log.md).
   Narrower than the other three (it doesn't touch a run's authorization,
   only how its record is displayed), included because it's genuinely
   checkable and genuinely absent elsewhere, not because it's the same
   scale of claim.

Together these are the open-source realization of the brain / hands /
session decoupling that the managed-agents thesis describes and that no
framework has shipped as a unit.

## What is *not* unique (do not lead with it)

Domain-agnostic loop, TypeScript-native, durable checkpoints, a policy gate
before actions, multi-agent bus, MCP/A2A, seven domain profiles. Every one is
matched or exceeded by a better-funded entrant.

## Direction vector — the next 12 months

The arrow on the chart points up and slightly right. Movement on X is
cheap; movement on Y is the whole game.

**Up (execute) — in order of leverage:**

1. **Publish.** Set `NPM_TOKEN`, merge the version PR. Every other score is
   capped at zero until packages resolve. Deliberately deferred until a
   reference use case exists to publish *for* — see item 4. (Y: 1.4 → ~2.2)
2. ~~Durable run registry on the control plane.~~ **Done.** `naro serve
   --pg <url>` / `NARO_PG_URL` (`--registry-pg`/`--journal-pg`/
   `--approvals-pg` to split them) wires `PgRunRegistry` + `PgEventStore` +
   `PgApprovalBridge`, so `GET /runs`, `/runs/:id/events`, and `/approvals`
   are all real across replicas, not just SQLite-single-host. (Y → ~2.6)
3. **Python client** for `serveEnvironment` and `HttpAgentBus`, and a
   Python harness hook for Claude Code. The kernel stays TypeScript; the
   door widens to the Python-majority market. (Y → ~3.2)
4. **Reference users.** One regulated-industry deployment that ships an
   evidence bundle to an auditor is worth more than any feature.

**Right (vision) — done since the last review:**

- ~~Provenance as a policy input.~~ **Shipped** ([ADR 0010](adr/0010-provenance-is-a-policy-input.md)).
  `Observation.trust` (`system | tool | external`), delimited untrusted
  content in the transcript, and `ctx.provenance` available to
  `PolicyEngine` — a rule can deny `shell.exec` when the triggering
  observation came from a web page. Prompt injection is a kernel-enforced
  control, not a prompt-engineering suggestion; no other entrant in this
  field has it. `npm run example:research` demonstrates it; see
  [architecture.md §2](architecture.md#provenance-is-a-policy-input-not-just-a-transcript-label).
  (X: patterns 4 → 5, total 4.6 → ~4.7 — this is a single-criterion nudge,
  not a full re-score of every axis.)

**Right (vision) — the next move that widens the moat:**

- **Candidate identified: provenance for tool *definitions*, not just tool
  *output*.** [ADR 0016](adr/0016-tool-definitions-are-provenance-pinned.md)
  (proposed) extends ADR 0010's already-unique provenance mechanism to a
  documented, current attack class against MCP specifically — tool
  poisoning (a malicious description read as trusted metadata before any
  action runs) and rug pulls (a previously-approved tool's definition
  changing unnoticed). Independent 2026 scans find the majority of public
  MCP servers carry exploitable flaws and name exactly these two patterns;
  no orchestration framework, security kernel, or lab SDK in this field's
  scored list does definition-level pinning today — this would be a
  fourth "only Naro has" property, not an incremental one. Also found in
  the same pass: [ADR 0015](adr/0015-mcp-server-calls-route-through-the-harness-gate.md)
  (proposed) closes a real asymmetry where Naro's *own* tools, served
  over MCP to an external host, bypassed the policy gate and journal
  entirely — a correctness fix, not a moat move, but a precondition for
  claiming "first-class treatment" in both directions honestly.
- **Second candidate: delegated principal identity as a policy input.**
  [ADR 0017](adr/0017-delegated-principal-is-a-policy-input.md) (proposed)
  gives `PolicyContext` a `principal` field — "whose authority is this
  action under," distinct from `grants` (what the agent can do) and
  `provenance` (how trustworthy the evidence is). This tracks a real 2026
  market move (Cross App Access adopted into MCP's own auth spec,
  Microsoft Entra Agent ID reaching GA) without Naro reimplementing OAuth
  — the gateway resolves identity, Naro's contribution is giving that
  identity a seat at the same structural gate every action already passes
  through. Complements 0016 rather than competing with it: one closes a
  content-trust gap, the other an authority gap.
- **Third and fourth candidates: provenance closes its remaining two
  surfaces.** [ADR 0019](adr/0019-memory-writes-are-provenance-tagged.md)
  extends `Observation`/`Tool` trust-tagging to `MemoryEntry` — OWASP's
  2026 Agentic AI Top 10 names memory/context poisoning as ASI06
  specifically and prescribes "memory sanitization with provenance" as a
  leading defense; no entrant in this field's scored list tags persistent
  memory with evidence-origin the way ADR 0010 already tags observations.
  [ADR 0020](adr/0020-tool-source-collisions-are-not-silent.md) closes
  cross-server tool shadowing (a second MCP source claiming a trusted
  name), the sibling pattern to 0016's rug pull. Four ADRs, one thesis:
  every place untrusted content can reach a decision — observations, tool
  definitions, tool identity, memory — now has the same structural
  answer instead of three out of four.

## Cautions for a buyer

- Naro is a **kernel to build on**, not a hosted platform. A read-only
  ops console and a headless client SDK (`@naro/client`) now ship
  (`naro serve`'s `GET /console`) — but there is still no managed control
  plane and no SLA; the console is a reference UI for self-hosted
  deployments, not a hosted product ([docs/product/prd-003-managed-control-plane.md](product/prd-003-managed-control-plane.md)
  is what a hosted one would need, and remains proposed, not shipped).
- Tamper-evidence is real; tamper-*proof* depends on your key custody
  (KMS/HSM) — the seal moves trust, it does not remove it.
- Single-author project at v0.1.0. Adopt for the architecture with eyes
  open about bus factor; the Apache-2.0 license and zero-dependency core
  make the fork risk acceptable.
- Node 24+ only. No Python runtime story yet.

## Cautions for the vendor

- Leading with breadth (seven profiles, "universal") reads as unfocused to
  the buyer who values the moat. Lead with the proof.
- The end-to-end path (`init → serve → verify`) broke at step one before
  this review despite 330+ green unit tests. Composed-path tests are the
  kernel's own thesis applied to itself — keep them.
- Every month unpublished, a funded entrant can copy the verification-state
  idea. Architecture is defensible only once it has users.
