# Naro

**The evidence-gated agent kernel.** Every action is authorized before it runs
and verified after. A run is not complete until the kernel has evidence.

Naro is an open-source runtime for autonomous agents in which *authorization*
and *verification* are states in the agent's state machine, not callbacks you
remember to add. The model proposes; the runtime authorizes, executes, observes,
and checks. Completion is a claim until a verifier accepts it.

```
 Goal ──► Reasoner ──► Decision ──► WAITING_FOR_PERMISSION ──► ACTING
   ▲                     (claim)         policy gate               │
   │                                                               ▼
 REPLANNING ◄── VERIFYING ◄── OBSERVING ◄── Environment / Tool ◄───┘
                   │
                   └──► immutable event journal (audit · resume · eval · UI)
```

The same kernel runs a coding agent, a research agent, a SQL agent, or a robot
controller. Domains are profiles; models are adapters; the loop and its gates
do not change.

## Why

Agent frameworks give you control flow. Agent security kernels give you a
policy gate. Neither makes *proof of outcome* part of the runtime. Naro does:

- **Authorization is structural.** `AgentRunner.policy` is required. Every
  action passes `WAITING_FOR_PERMISSION`; unknown tools are denied; destructive
  side effects require approval. The model cannot self-authorize.
- **Verification is a state, not a hook.** A `complete` decision enters
  `VERIFYING`. If the verifier rejects the evidence, the runner enters
  `REPLANNING` and the reasoner sees why. Per-action verification works the
  same way.
- **Intent and evidence never merge.** An `Action` is what was attempted; an
  `Observation` is what happened. Failures are observations with
  `success: false`, so the reasoner sees reality.
- **The journal is the truth.** Events are immutable, sequenced, and exported to
  JSONL, SQLite, Postgres, or OTLP. Checkpoints are taken only at reasoning
  boundaries, so a resumed run never restarts a half-executed side effect.
- **Benchmarks gate regressions.** `naro bench --baseline` runs named cases
  through the real runtime and exits non-zero when outcomes regress or cases
  disappear.
- **Domain safety lives below the model.** Path jails via `realpath`,
  destination allowlists that revalidate every redirect, database-enforced
  read-only SQL, declared runbooks instead of shell, robotics estop latches.

## How Naro differs

| | Orchestration frameworks (LangGraph, Mastra, CrewAI, OpenAI Agents SDK) | Agent security kernels (agent-kernel, Bastion, Weaver) | Harness SDKs (Claude Agent SDK, Codex SDK) | Naro |
|---|---|---|---|---|
| Agent loop | yes | no — middleware only | yes, fixed | yes, 17-state machine |
| Policy gate before every action | opt-in guardrails | yes | vendor permission model | yes, required |
| Verification as a runtime state | build it yourself | no | no | yes |
| Intent / evidence separation | messages | audit log | messages | `Action` vs `Observation` |
| Model neutrality | yes | yes | single vendor | yes, capability-gated |
| Domain neutrality | yes | tools only | coding | yes, 7 profiles |
| Regression-gated benchmarks in CI | external tooling | no | no | `naro bench --baseline` |

Naro also matches the *brain / hands / session* decomposition described in
Anthropic's [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents):
`AgentRunner` + `Reasoner` are the brain, `Environment.execute(action) →
Observation` is the hands, and the event journal is the session. See
[docs/positioning.md](docs/positioning.md) for the full analysis and what is
and is not implemented today.

## Quickstart

```bash
npm install
npm run check        # build every package, then run every test
npm run example      # watch the full agent loop, event by event
```

A minimal agent (see `examples/minimal-agent/src/index.ts`):

```ts
const runner = new AgentRunner({
  spec: createAgentSpec({ name: 'my-agent', goal }),
  reasoner: new DirectReasoner((ctx) => /* decide(ctx) → Decision */),
  executor: new CompositeExecutor({
    'tool://': new ToolExecutor(registry),
    'env://':  environment,
  }),
  policy: createToolPolicy(registry),
  verifier,
});
const result = await runner.run();
```

## Repository map

| Package | Role | Depends on |
|---|---|---|
| `@naro/core` | Primitives: Goal, Task, Action, Observation, Events, 17-state machine, Reasoner/Policy/Verifier/Context seams | nothing |
| `@naro/runtime` | AgentRunner, immutable event journal, aborting deadlines, checkpoints, SQLite durability, leases | core |
| `@naro/model` | Capability-gated `Model`/`ModelProvider`, message vocabulary, `MockModel` | core |
| `@naro/tools` | Tool contracts, schemas, executor, baseline policy, secret providers, worker sandbox | core |
| `@naro/environment` | `Environment` contract + `InMemoryEnvironment` | core |
| `@naro/memory` | Tiered memory with in-memory, JSONL, and SQLite FTS5 stores | core |
| `@naro/context` | `ContextEngine`: sources → rank → select → compress → budget | core |
| `@naro/reasoning` | `ReAct`, `PlanExecute`, `Reflection` strategies over `Model` | core, model |
| `@naro/policy` | `RulePolicyEngine`: ordered rules for deny/approval/limit/audit decisions | core |
| `@naro/observability` | metrics, redaction, JSONL/console export, and SQLite event journal | core |
| `@naro/evaluation` | `BenchmarkRunner`: cases → real runs → outcome checks and event metrics | core, runtime, observability |
| `@naro/verification` | Schema, predicate, command, human, composite, and calibrated LLM-judge verifiers | core, model, tools |
| `@naro/multiagent` | directory, local/HTTP/durable buses, JWT hooks, policy-gated delegation | core, tools |
| `@naro/adapter-openai` | OpenAI-compatible `Model`/`Provider` (OpenAI, Ollama, vLLM, …) — raw fetch, injectable | core, model |
| `@naro/adapter-mcp` | MCP `ToolSource`: discovered server tools flow through the standard pipeline | core, tools |
| `@naro/adapter-otel` | OTLP/HTTP `EventExporter` — events land in any OTel collector | core, observability |
| `@naro/adapter-opa` | `PolicyEngine` over OPA/Rego HTTP — fail-closed by default | core |
| `@naro/adapter-anthropic` | Anthropic Messages API, streaming, tools, forced-tool structured output | core, model |
| `@naro/adapter-gemini` | Gemini generateContent, tools, vision, native structured output | core, model |
| `@naro/adapter-a2a` | A2A transport for `AgentBus`: agent cards + JSON-RPC `tasks/send` | core, multiagent |
| `@naro/adapter-pg` | Postgres `CheckpointStore`, `EventStore`, `MemoryStore`, `LeaseStore`, `LimitStore`, `AgentBus` — the multi-host durability tier | core, runtime, memory, observability, policy, multiagent |
| `@naro/adapter-harness` | `HarnessKernel` + Claude Agent SDK / OpenCode hook mappers — Naro's gate and journal beneath foreign harnesses | core, runtime |
| `@naro/contract-tests` | Shared suites every port implementation must pass (dev-only) | core |
| `@naro/profile-coding` | `WorkspaceEnvironment` (jailed fs + shell) + `codingTools()` | core, environment, tools |
| `@naro/profile-research` | `ResearchEnvironment` (allowlisted fetch + citations that require fetched evidence) + `researchTools()` | core, environment, tools |
| `@naro/profile-browser` | `BrowserEnvironment` over a `BrowserDriver` port; `PlaywrightDriver` (optional peer dep) | core, environment, tools |
| `@naro/profile-data` | `DataEnvironment` — parameterized SQL, read/write capability split, row caps; `NodeSqliteDriver` (node:sqlite) | core, environment, tools |
| `@naro/profile-devops` | `DevOpsEnvironment` — runbook registry (declared argv tasks, no arbitrary shell), HTTP probes | core, environment, tools |
| `@naro/profile-workflow` | `WorkflowEnvironment` — DAG execution through a nested executor, `$step` refs, retries | core, environment, tools |
| `@naro/profile-robotics` | `RoboticsEnvironment` over a `RobotDriver` port; `GridSimDriver` world-model sim; latched estop | core, environment, tools |
| `@naro/cli` | `naro run` / `bench` / `replay` / `states` | core, runtime, observability, evaluation |
| `examples/` | `minimal-agent` (scripted) · `react-agent` (model loop) · `coding-agent` (domain profile) · `governed-agent` (gates + sealed journal) · `research-agent` (provenance gate) | all |

## Learn the stack

`docs/learn/` is a ground-up course. Read 00–03 for the model and reasoning
foundations, 04–07 for retrieval, tools, context, and memory, then 08–12 for
runtime design, evaluation, security, and production reliability. After each
section, trace the same concept through `examples/minimal-agent` and
`examples/react-agent`.

00 [how LLMs work](docs/learn/00-how-llms-work.md) ·
01 [training](docs/learn/01-training.md) ·
02 [prompting](docs/learn/02-prompting.md) ·
03 [reasoning patterns](docs/learn/03-reasoning-patterns.md) ·
04 [RAG](docs/learn/04-rag.md) ·
05 [tool calling](docs/learn/05-tool-calling.md) ·
06 [context engineering](docs/learn/06-context-engineering.md) ·
07 [memory](docs/learn/07-memory.md) ·
08 [agent loops](docs/learn/08-agent-loops.md) ·
09 [multi-agent](docs/learn/09-multi-agent.md) ·
10 [evaluation](docs/learn/10-evaluation.md) ·
11 [security & policy](docs/learn/11-security-and-policy.md) ·
12 [scale & reliability](docs/learn/12-scale-and-reliability.md)

Practice in three passes:

1. Run `npm run example` and read the
   [minimal agent](examples/minimal-agent/README.md) for the complete loop.
2. Run `npm run example:react` and read the
   [ReAct agent](examples/react-agent/README.md) for model-driven tool use.
3. Run `npm run example:coding` and read the
   [coding agent](examples/coding-agent/README.md) for a real domain profile.

Documentation paths:

- [Build your first safe agent](docs/getting-started.md)
- [Documentation map](docs/README.md)
- [Architecture](docs/architecture.md)
- [End-to-end use cases](docs/use-cases.md)
- [Production readiness](docs/production-readiness.md)
- [Design principles](docs/principles.md)

## Status

`v0.2` worktree, `0.1.0` packages, not yet published to npm.

Implemented in this repository:

- Kernel: 17-state machine, immutable sequenced events, hash-chained journal
  (`prev`/`hash` on every event, verified by `verifyChain()` and
  `naro verify <run.jsonl>`), optional Ed25519 journal sealing
  (`sealKey` → `journal.sealed` → `naro verify --pubkey`), checkpoints at
  reasoning boundaries with
  deterministic idempotency keys and chain-head continuation on resume,
  abortable action timeouts, runner leases with heartbeat fencing, token and
  cost budgets.
- Gates: required `PolicyEngine`, `createToolPolicy` (unknown tool → deny,
  missing grant → deny, destructive → approval), `RulePolicyEngine`, shared
  `LimitStore` quotas, OPA/Rego adapter, SQLite-backed approvals that survive a
  runner crash.
- Provenance as a policy input: `Observation.trust` (system / tool /
  external), graded transcript delimiters, `ctx.provenance` at the gate, and
  `denyExternalTriggered` refusals for side effects triggered by outside
  content.
- Evidence: schema, predicate, command, human, composite, and rubric-scored
  LLM-judge verifiers; per-run evidence record (`buildEvidence`) joining
  policy verdict → action → observation → verifier verdict per action;
  `BenchmarkRunner` with stored baselines and `naro bench --baseline`
  regression gating.
- Durability tiers: in-memory, JSONL, SQLite (`node:sqlite`, FTS5 recall), and
  Postgres (`@naro/adapter-pg`: checkpoints, events, memory, leases, limits,
  agent bus).
- Session: `wake(runId)` rebuilds a run from the journal alone — checkpoints
  are an optimization; `runner.compact(summary)` stores session compaction
  as a journal event; `serveEnvironment`/`HttpEnvironment` run hands in a
  separate process or host over HTTP.
- Serving: durable `RunRegistry` (SQLite/Postgres) indexes every run —
  `GET /runs` survives restarts and is shared across replicas; a shared
  journal answers cross-replica `GET /runs/:id/events`; `SqliteApprovalBridge`
  exposes `GET`/`POST /approvals` over HTTP.
- Reasoning: ReAct (streaming, parallel `act-batch`), PlanExecute, Reflection,
  TreeSearch.
- Models: OpenAI-compatible, Anthropic, Gemini adapters; `failover()`
  composition across providers.
- Coordination: local, HTTP (HS256 JWT + JWKS/OIDC), durable, A2A, and Postgres
  buses; policy-gated `delegate` tool with bounded subagents (depth cap,
  capability allowlist, grant subset, scoped context).
- Harness governance: `@naro/adapter-harness` runs the policy gate, verifier,
  and hash-chained journal beneath Claude Agent SDK hooks and OpenCode
  plugins — `naro verify` works on runs Naro did not drive.
- Profiles: coding, research, browser, data, devops, workflow, robotics.
  Coding includes `RepoContextSource` (git state + `AGENTS.md`/`README`).
- Prompt caching: `cacheBreakpoint`/`cacheTools` markers map to Anthropic
  `cache_control`; providers that auto-cache ignore them.
- Isolation: `SandboxedExecutor` (worker thread, heap caps, kill on timeout).
  This is not an OS sandbox; run hostile code behind an external executor.

Not implemented (see [docs/positioning.md](docs/positioning.md#roadmap)):
KMS/HSM-backed key custody for journal sealing (the `sealKey` port exists —
custody is deployment-owned), a Codex hook adapter (no documented tool-call
hook exists today), Redis stores, container-level sandboxing, hosted control
plane.

## License

Apache-2.0 — see [LICENSE](LICENSE).
