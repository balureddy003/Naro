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
npm run build        # tsc project references — builds in dependency order
npm test             # zero-dependency tests (node --test on TS directly)
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
| `@naro/core` | Primitives: Goal, Task, Action, Observation, Events, 18-state machine, Reasoner/Policy/Verifier/Context seams | nothing |
| `@naro/runtime` | AgentRunner (the only place transitions happen), EventBus, retry/timeout, checkpoint + recovery | core |
| `@naro/model` | Capability-gated `Model`/`ModelProvider`, message vocabulary, `MockModel` | core |
| `@naro/tools` | Tool contract, registry, JSON-schema validation, executor pipeline, baseline policy | core |
| `@naro/environment` | `Environment` contract + `InMemoryEnvironment` | core |
| `examples/` | Reference agents built on the public APIs only | all |

## Learn the stack

`docs/learn/` is a ground-up course — each concept explained plainly, with
diagrams, failure modes, security notes, and where it lives in the code:

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

Architecture deep-dive: [docs/architecture.md](docs/architecture.md) (C4 diagrams).
Design rules: [docs/principles.md](docs/principles.md).

## Status

`v0.1` — kernel + runtime + model/tools/environment layers, one working
reference agent. Reasoning strategies, context/memory engines, MCP adapter,
policy (OPA), and evaluation land in later phases — their seams already exist.

## License

Apache-2.0 — see [LICENSE](LICENSE).
