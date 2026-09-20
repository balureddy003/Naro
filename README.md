# Naro

**A universal, open-source foundation for building autonomous agents — in any domain.**

Naro is not a coding agent, a chatbot framework, or an LLM wrapper. It is the
small set of domain-agnostic primitives underneath systems like those: Goal →
Reason → Act → Observe → Verify → Replan, with explicit contracts, a real state
machine, checkpoints, and policy gates.

A coding agent, a research agent, and a robot controller are all *applications*
of the same kernel — they differ only in their environment, tools, context
sources, and reasoning strategy.

```
 Goal ──► Reasoner ──► Decision ──► Policy gate ──► Action
   ▲                                                  │
   │                                                  ▼
 Observation ◄── Environment/Tools ◄── Executor ◄── VERIFY
   │
   └──► events stream (audit · replay · eval · UI)
```

## Why

Every "agent framework" today bakes one domain into its core. Naro's bet is the
opposite: **the smallest universal kernel, everything else an adapter.**

- `core` knows nothing about Git, browsers, Kubernetes, or LLM vendors.
- Models are capability-gated interfaces — swap OpenAI for a local model freely.
- Tools are schema-contracted capabilities behind a policy gate.
- Environments are the *world* — files, browsers, clusters, robots — one contract.
- The runtime is deterministic, evented, checkpointed, and resumable.

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
| `@naro/runtime` | AgentRunner (the only place transitions happen), EventBus, retry/timeout, checkpoint + recovery | core |
| `@naro/model` | Capability-gated `Model`/`ModelProvider`, message vocabulary, `MockModel` | core |
| `@naro/tools` | Tool contract, registry, JSON-schema validation, executor pipeline, baseline policy | core |
| `@naro/environment` | `Environment` contract + `InMemoryEnvironment` | core |
| `@naro/memory` | Tiered `MemoryStore` (working→longterm) + in-memory/file stores | core |
| `@naro/context` | `ContextEngine`: sources → rank → select → compress → budget | core |
| `@naro/reasoning` | `ReAct`, `PlanExecute`, `Reflection` strategies over `Model` | core, model |
| `@naro/policy` | `RulePolicyEngine`: ordered rules for deny/approval/limit/audit decisions | core |
| `@naro/observability` | `EventExporter`, JSONL/console export, `computeMetrics()` from events | core |
| `@naro/evaluation` | `BenchmarkRunner`: cases → real runs → outcome checks and event metrics | core, runtime, observability |
| `@naro/verification` | Schema, predicate, command, human, composite, and calibrated LLM-judge verifiers | core, model, tools |
| `@naro/multiagent` | Agent directory, in-memory request bus, and policy-gated delegation tool | core, tools |
| `@naro/adapter-openai` | OpenAI-compatible `Model`/`Provider` (OpenAI, Ollama, vLLM, …) — raw fetch, injectable | core, model |
| `@naro/adapter-mcp` | MCP `ToolSource`: discovered server tools flow through the standard pipeline | core, tools |
| `@naro/adapter-otel` | OTLP/HTTP `EventExporter` — events land in any OTel collector | core, observability |
| `@naro/adapter-opa` | `PolicyEngine` over OPA/Rego HTTP — fail-closed by default | core |
| `@naro/contract-tests` | Shared suites every port implementation must pass (dev-only) | core |
| `@naro/profile-coding` | `WorkspaceEnvironment` (jailed fs + shell) + `codingTools()` | core, environment, tools |
| `@naro/profile-research` | `ResearchEnvironment` (allowlisted fetch + citations that require fetched evidence) + `researchTools()` | core, environment, tools |
| `@naro/profile-browser` | `BrowserEnvironment` over a `BrowserDriver` port; `PlaywrightDriver` (optional peer dep) | core, environment, tools |
| `@naro/cli` | `naro run` / `bench` / `replay` / `states` | core, runtime, observability, evaluation |
| `examples/` | `minimal-agent` (scripted) · `react-agent` (model loop) · `coding-agent` (domain profile) | all |

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

Practice in two passes:

1. Run `npm run example` and read
   [`examples/minimal-agent`](examples/minimal-agent/README.md) to see the
   complete loop without a model dependency.
2. Run `npm run example:react` and read
   [`examples/react-agent`](examples/react-agent/README.md) to connect model
   tool calls, context, memory, policy, and verification.

Architecture deep-dive: [docs/architecture.md](docs/architecture.md) (C4 diagrams).
Design rules: [docs/principles.md](docs/principles.md).

## Status

`v0.2` worktree — kernel, runtime, model, tools, environment, memory, context,
three reasoning strategies, concrete verifiers, declarative policy,
event-derived observability, a benchmark harness, and in-process multi-agent
delegation—plus OpenAI-compatible and MCP adapters. Proven by two runnable
reference agents. Next: durable distributed coordination, OPA policy and
OpenTelemetry adapters, domain profiles, and release automation.

## License

Apache-2.0 — see [LICENSE](LICENSE).
