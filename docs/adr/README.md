# Architecture Decision Records

Each record captures one decision that shapes Naro, the alternatives that were
rejected, and the consequences the codebase now lives with. Records are
numbered in the order they were written and are never edited after acceptance;
a superseding record links back.

Read these when you want to know *why* the code is shaped the way it is. Read
[architecture.md](../architecture.md) when you want to know *what* it does.

| # | Decision | Status |
|---|---|---|
| [0001](0001-verification-is-a-runtime-state.md) | Verification is a state in the agent state machine | accepted |
| [0002](0002-action-and-observation-are-separate.md) | Intent (`Action`) and evidence (`Observation`) are separate records | accepted |
| [0003](0003-policy-engine-is-required.md) | `AgentRunner.policy` is required; the model cannot self-authorize | accepted |
| [0004](0004-checkpoints-at-reasoning-boundaries.md) | Checkpoints are taken only at reasoning boundaries | accepted |
| [0005](0005-hash-chain-in-the-event-bus.md) | The hash chain is computed in the event bus, with optional fields | accepted |
| [0006](0006-core-depends-only-on-node.md) | `@naro/core` imports nothing beyond `node:` builtins | accepted |
| [0007](0007-journal-is-the-source-of-truth-for-session-state.md) | The journal is the source of truth for session state (`wake`, compaction-as-event) | accepted |
| [0008](0008-environments-are-reachable-over-http.md) | Environments are reachable over HTTP | accepted |
| [0009](0009-governance-beneath-foreign-harnesses.md) | Governance adapters run beneath foreign harnesses via their tool-call hooks | accepted |
| [0010](0010-provenance-is-a-policy-input.md) | `Observation.trust` and `ctx.provenance` make evidence origin a policy input | accepted |
| [0011](0011-policy-verdicts-carry-reasons.md) | `PolicyVerdict` adds a reason to every gate outcome | accepted |
| [0012](0012-control-plane-identity.md) | Principals + roles on `naro serve`; approver and policy identity land in the journal | accepted |
| [0013](0013-tenant-scoped-run-visibility.md) | Optional `tenantId` on principals scopes `/runs` visibility; approvals explicitly out of scope | accepted |
| [0014](0014-cost-aware-escalation-is-a-reasoner.md) | Cost-aware model escalation is a `Reasoner`, not a new kernel primitive | accepted |
| [0015](0015-mcp-server-calls-route-through-the-harness-gate.md) | `McpRegistryServer` routes inbound tool calls through the harness gate, not `tool.execute()` directly | accepted |
| [0016](0016-tool-definitions-are-provenance-pinned.md) | Tool definitions from untrusted sources are provenance-pinned (MCP tool poisoning / rug-pull defense) | accepted |
| [0017](0017-delegated-principal-is-a-policy-input.md) | Delegated principal identity (`PolicyContext.principal`) is a policy input, distinct from grants and provenance | accepted |
| [0018](0018-attested-retention-pruning.md) | Retention pruning is an attested chain re-anchor (`journal.retention.pruned`), not silent deletion | accepted |
| [0019](0019-memory-writes-are-provenance-tagged.md) | `MemoryEntry`/`MemoryInput` carry `trust`, extending provenance to persistent memory (OWASP ASI06 memory poisoning) | accepted |
| [0020](0020-tool-source-collisions-are-not-silent.md) | Tool name collisions across sources are surfaced and require resolution, not silently overwritten (cross-server tool shadowing) | accepted |
| [0021](0021-otel-span-mapping-for-the-genai-semantic-conventions.md) | `@naro/adapter-otel` gains span export using the OTel GenAI semantic conventions, alongside the existing log export | accepted |
| [0022](0022-attributed-run-cancellation-endpoint.md) | `naro serve` gains an attributed `POST /runs/:id/cancel` (the Article 14 stop button), reusing the existing per-run `AbortController` | accepted |
| [0023](0023-console-renders-the-evidence-record-not-a-log.md) | The console/`@naro/client` render `buildEvidence()` directly — no separate telemetry pipeline that could disagree with `naro verify` | accepted |
| [0024](0024-admin-api-surface-for-registry-and-retention.md) | `naro serve` gains `admin`-gated endpoints for tool-collision resolution, definition acknowledgment, and retention pruning — HTTP wiring onto ADR 0016/0018/0020's existing decisions | accepted |
| [0025](0025-live-principal-store.md) | A `PrincipalStore` port makes `naro serve` identity live and admin-writable — no config-file edit, no restart, to add or revoke a teammate | accepted |
| [0026](0026-me-authenticated-self-description.md) | `GET /me` returns the caller's principal — role-accurate UI rendering (PRD-006 req 7) without probing privileged endpoints | accepted |
| [0027](0027-hosted-account-signup-and-sessions.md) | Email/password signup for PRD-003's hosted product, layered on ADR 0025's `PrincipalStore` — a signed-up account IS a principal, not a second identity system | accepted |

## Template

```markdown
# NNNN — Title

Status: proposed | accepted | superseded by NNNN
Date: YYYY-MM-DD

## Context
What forces were in play. Link to code and tests.

## Decision
One paragraph. Present tense.

## Alternatives considered
Each with the reason it lost.

## Consequences
What became easier, what became harder, what must now be maintained.
```
