# Positioning

*Explanation.* Where Naro sits relative to other agent software, what
distinguishes it, and which parts of that story are implemented versus planned.

## The field

Agent software in 2026 falls into three groups.

**Orchestration frameworks** — LangGraph, CrewAI, Mastra, Pydantic AI, the
OpenAI Agents SDK, Google ADK, Microsoft Agent Framework. They own control
flow: graphs, roles, handoffs, durable workflows, memory, evals. Guardrails and
human approval exist but are opt-in constructs the developer wires in.

**Agent security kernels** — agent-kernel, Bastion, Weaver Kernel, VAK. They
own enforcement: a structural gate every tool call must pass, default-deny
policy, append-only or hash-chained audit, sometimes rollback. They do not
own the agent loop; they sit beneath one.

**Harness SDKs** — Claude Agent SDK, Codex SDK, OpenCode. They ship a fixed,
capable coding loop with a computer attached. They are single-vendor or
single-domain by design, and the leading coding harnesses are converging on
the same conventions (`AGENTS.md`, MCP, subagents, persisted sessions).

The architectural thesis shaping all three is Anthropic's
[Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents):
separate the *brain* (model + harness loop), the *hands*
(`execute(name, input) → string` sandboxes that can be replaced freely), and the
*session* (an append-only event log that outlives any process). Harnesses
encode assumptions that go stale as models improve; stable interfaces between
these three parts are what survive.

## What Naro is

Naro has the loop of the first group and the gate of the second, and adds one
thing neither has: **verification is a state in the runtime's state machine.**

- A `complete` decision is a claim. The runner enters `VERIFYING`; if the
  verifier rejects the evidence, the runner enters `REPLANNING` and records an
  observation naming the verifier and the reason
  (`runtime/src/runner.ts`, `handle()` → `case 'complete'`).
- Per-action verification follows the same path (`verifyAll()`).
- `Action` (intent) and `Observation` (evidence) are distinct records. A
  failed tool, a policy denial, or a refused approval is an observation with
  `success: false`; the reasoner is shown reality, not a message.
- Benchmarks run the real runtime against named cases and compare with stored
  baselines; `naro bench --baseline` exits non-zero on regression or removed
  cases (`cli/src/commands.ts`, `evaluation/src/regression.ts`).

Naro also already has the Managed Agents shape:

| Managed Agents | Naro today | Boundary |
|---|---|---|
| brain | `AgentRunner` + `Reasoner` | in-process |
| hands | `Environment.execute(action, ctx) → Observation`, `ActionExecutor` | in-process; `SandboxedExecutor` is a worker thread, not an OS sandbox |
| session | `EventBus` history, `SqliteEventStore`, `PgEventStore`, checkpoints | resume is from checkpoint, not by replaying the journal |

## What is not a differentiator

These are true of Naro and also true of well-funded alternatives. Do not lead
with them.

- Domain-agnostic kernel — LangGraph, ADK, and Microsoft Agent Framework make
  the same claim.
- TypeScript-native — Mastra is the established TypeScript default.
- Checkpoints, durability, resumability — LangGraph, Mastra, Pydantic AI.
- A policy gate before each action — agent-kernel, Bastion, Weaver; OpenAI
  guardrails.
- Seven domain profiles — breadth without a headline reads as lack of focus.

## Positioning statement

> Naro is the evidence-gated agent kernel. Every action is authorized before
> it runs and verified after, and a run is not complete until the kernel has
> proof. Any model, any domain, any harness.

The intended buyer is a team that must show *why* an agent did something and
*that* the outcome was checked: regulated workloads, infrastructure operators,
and anyone putting an agent in front of a database, a cluster, or a machine.

## Roadmap

Three phases. All are implemented; the remaining work is depth, not new
direction.

### Phase 1 — Proof bundles ✅ shipped

- Hash-chained event journal: each `NaroEvent` carries `prev` and `hash`
  (SHA-256 over the canonical event); `naro verify <run.jsonl>` recomputes the
  chain and exits non-zero on a break. Implemented in `EventBus.emit()`,
  `verifyChain()` (`@naro/core`), and the `prev`/`hash` columns on
  `SqliteEventStore` and `PgEventStore`. See
  [ADR 0005](adr/0005-hash-chain-in-the-event-bus.md).
- Per-run evidence record: `buildEvidence(events)` (`@naro/observability`)
  joins policy verdict → action → observation → verifier verdict per action;
  `naro verify` prints it (`--json` for the machine-readable record).
- Verifier provenance: goal-completion `verification.completed` events now
  carry `verifier`, matching the per-action path.
- Journal continuity across resume: checkpoints store the chain head, so a
  resumed run's events link into the original chain rather than starting a
  new one.
- Sealed journal heads: `AgentDeps.sealKey` emits a terminal
  `journal.sealed` event — an Ed25519 signature over the head. `naro verify
  --pubkey` pins the expected key; `wake()` refuses a sealed journal. The
  trust boundary is key custody (KMS/HSM recommended), which is documented
  rather than hidden.

### Phase 2 — Session as the source of truth ✅ shipped

- Stateless `wake(runId)`: `AgentRunner.wake(source, runId?)` rebuilds the
  session (tasks, actions, observations, context, iteration, chain head)
  from any `JournalSource` — `SqliteEventStore`, `PgEventStore`, or a raw
  event list. Checkpoints remain as a fast-hydrate optimization. See
  [ADR 0007](adr/0007-journal-is-the-source-of-truth-for-session-state.md).
- Session compaction as a kernel operation: `runner.compact(summary)` emits
  `session.compacted`, and rebuilds collapse pre-compaction observations to
  the summary. The journal is never rewritten — compaction is an event.
- Remote `Environment` transport: `serveEnvironment` + `HttpEnvironment`
  (`@naro/environment`, `node:http`) put the hands in another process or
  host behind the same contract. See
  [ADR 0008](adr/0008-environments-are-reachable-over-http.md).

### Phase 3 — Governance under any harness ✅ shipped

- `@naro/adapter-harness`: `HarnessKernel` maps a foreign tool call to a
  Naro `Action`, runs the policy gate, and journals the verdict plus the
  post-execution observation — all hash-chained, so `naro verify` works on
  runs Naro did not drive. Shape mappers for Claude Agent SDK hooks
  (`PreToolUse`/`PostToolUse` → `permissionDecision`), OpenCode plugins
  (`tool.execute.before/after`), and Devin CLI's `hooks.v1.json` command-hook
  contract (no per-call id, so the kernel's FIFO fallback carries it) ship
  without vendor dependencies. Codex CLI has no documented tool-call hook
  today and is not claimed. See
  [ADR 0009](adr/0009-governance-beneath-foreign-harnesses.md).
- Coding-profile parity: `RepoContextSource` (git branch/status/commits +
  `AGENTS.md`/`README` as query-independent context), `cacheBreakpoint` /
  `cacheTools` markers through `buildMessages` → Anthropic `cache_control`,
  and bounded subagent delegation (`DelegationBounds`: depth cap, capability
  allowlist, grant subset, scoped context — `READ_ONLY_DELEGATION` preset).
- Transcript summarization lands via kernel compaction (`session.compacted`
  events) rather than a prompt-side window.

### Also shipped — a reference UI, not a new phase

`@naro/client` (typed, headless, TanStack Query/Zag.js-split control-plane
SDK) and `naro serve`'s built-in `GET /console` ship alongside the three
phases above, not as a fourth one — they don't extend what the kernel
proves, only how a self-hosted deployment can look at it. The one
property worth naming: the console renders `buildEvidence()` directly, the
same correlation `naro verify` uses, with no separate telemetry pipeline
that could show something the journal disagrees with. See
[ADR 0023](adr/0023-console-renders-the-evidence-record-not-a-log.md).
This is not a hosted product — no managed control plane, no SLA; see
[docs/product/prd-003-managed-control-plane.md](product/prd-003-managed-control-plane.md)
(proposed) for what one would need.

## Related

- [Architecture](architecture.md) — the runtime view that enforces the claims
  above.
- [Principles](principles.md) — the review rules.
- [Production readiness](production-readiness.md) — what a deployment must
  still provide.
- [Market quadrant](market-quadrant.md) — scored vision × execution field
  and the direction vector.
- [EU AI Act Article 12 mapping](compliance/eu-ai-act-article-12.md) — what
  the evidence architecture already gives the regulated-workload buyer
  named above, and what's still missing.
