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
| **Naro** | **Evidence-gated kernel** | **4.6** | **1.4** |

Vision scoring notes — where Naro earns its X: runtime-enforced governance 5
(policy required, `VERIFYING` is a state), evidence 5 (hash chain + Ed25519
seal + `naro verify`), decoupling 5 (`wake(runId)`, HTTP environments),
neutrality 5 (harness adapter beneath Claude/OpenCode), patterns 4 (all
present; provenance not yet a policy input), domains 4. Nobody else scores
above 3 on the first three criteria: orchestration frameworks let you
*build* verification; kernels gate but never check outcomes; lab SDKs are
single-vendor.

Execute scoring notes — where Naro loses its Y: distribution 0 (packages
unpublished, by choice — see the direction vector; `naro init` scaffolds
to a 404 until then), hardening 3 (Postgres ports, leases, drain, probes,
and now a durable run registry + journal all exist; `/approvals` is still
SQLite-only on Postgres deployments), ecosystem 3, DX 3 (deep docs, but the
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

Three properties, each verified in code, none present in any other entrant:

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
   --pg <url>` / `NARO_PG_URL` (`--registry-pg`/`--journal-pg` to split
   them) wires `PgRunRegistry` + `PgEventStore`, so `GET /runs` and
   `/runs/:id/events` are real across replicas, not just SQLite-single-host.
   Still open: `/approvals` has no `PgApprovalBridge` — the approval queue
   stays per-replica on Postgres deployments today. (Y → ~2.6)
3. **Python client** for `serveEnvironment` and `HttpAgentBus`, and a
   Python harness hook for Claude Code. The kernel stays TypeScript; the
   door widens to the Python-majority market. (Y → ~3.2)
4. **Reference users.** One regulated-industry deployment that ships an
   evidence bundle to an auditor is worth more than any feature.

**Right (vision) — the one move that widens the moat:**

- **Provenance as a policy input.** `Observation.trust`
  (`system | tool | external`), delimited untrusted content in the
  transcript, and `ctx.provenance` available to `PolicyEngine` — so a rule
  can deny `shell.exec` when the triggering observation came from a web
  page. Prompt injection becomes a kernel-enforced control rather than a
  prompt-engineering suggestion; no entrant has this. (X: 4.6 → 4.9)

## Cautions for a buyer

- Naro is a **kernel to build on**, not a hosted platform. There is no
  console, no managed control plane, no SLA.
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
