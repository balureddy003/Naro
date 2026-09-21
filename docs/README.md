# Naro Documentation

Choose the path that matches what you are trying to accomplish.

## Get started

New to Naro:

1. [Build your first safe agent](getting-started.md) — offline, policy-gated,
   verified, and observable.
2. [Glossary](glossary.md) — the vocabulary used throughout the project.
3. [How LLMs work](learn/00-how-llms-work.md) — begin the concept course.

Runnable examples:

| Level | Example | Run |
|---|---|---|
| 1 | [Minimal agent](../examples/minimal-agent/README.md) | `npm run example` |
| 2 | [ReAct agent](../examples/react-agent/README.md) | `npm run example:react` |
| 3 | [Coding agent](../examples/coding-agent/README.md) | `npm run example:coding` |

## Tutorials and use cases

[End-to-end use cases](use-cases.md) covers production-shaped compositions for:

- coding;
- cited research;
- browser automation;
- SQL and data;
- DevOps runbooks;
- deterministic workflows;
- robotics;
- multi-agent delegation.

Each use case names its capabilities, controls, evidence, and production
boundary.

## Concepts

The learning course moves from model mechanics to production operation:

1. [How LLMs work](learn/00-how-llms-work.md)
2. [Training](learn/01-training.md)
3. [Prompting and structured output](learn/02-prompting.md)
4. [Reasoning patterns](learn/03-reasoning-patterns.md)
5. [Retrieval-augmented generation](learn/04-rag.md)
6. [Tool calling and MCP](learn/05-tool-calling.md)
7. [Context engineering](learn/06-context-engineering.md)
8. [Memory](learn/07-memory.md)
9. [Agent loops and state machines](learn/08-agent-loops.md)
10. [Multi-agent systems](learn/09-multi-agent.md)
11. [Evaluation](learn/10-evaluation.md)
12. [Security and policy](learn/11-security-and-policy.md)
13. [Scale and reliability](learn/12-scale-and-reliability.md)

## Architecture and design

- [Architecture](architecture.md) — system, packages, runtime, data flow,
  deployment, and extension rules.
- [Positioning](positioning.md) — where Naro sits and what distinguishes it.
- [Market quadrant](market-quadrant.md) — analyst-style vision × execution
  scoring of the field, Naro's position, and the 12-month direction vector.
- [Evidence-gated completion](concepts/evidence-gated-completion.md) — why a
  run isn't done until the kernel has proof, and how the hash chain and
  evidence record work.
- [Architecture decision records](adr/README.md) — the load-bearing choices
  and their rejected alternatives.
- [Design principles](principles.md) — enforceable review rules.
- [Contract tests](../contract-tests/README.md) — executable compatibility for
  replaceable ports.
- [Documentation style](documentation-style.md) — page types, voice, claim
  standards, and maintenance checklist.

## Operations and production

- [Production readiness](production-readiness.md) — authorization, secrets,
  isolation, durability, leases, delivery, observability, and release gates.
- [Deploying Naro](deploy.md) — topologies (single host, multi-host Postgres,
  remote hands, beneath foreign harnesses), networking, scaling, and the
  Dockerfile/compose/k8s manifests.
- [`@naro/observability`](../observability/README.md) — metrics, redaction,
  JSONL, SQLite event journal, and export lifecycle.
- [`@naro/adapter-otel`](../adapters/otel/README.md) — OTLP/HTTP logs.
- [`@naro/evaluation`](../evaluation/README.md) — benchmark reports and baseline
  comparison.
- [`naro` CLI](../cli/README.md) — scaffold, run, bench, replay, verify, and states.

## Reference by subsystem

### Kernel and runtime

- [`@naro/core`](../core/README.md)
- [`@naro/runtime`](../runtime/README.md)
- [`@naro/model`](../model/README.md)
- [`@naro/reasoning`](../reasoning/README.md)

### Capabilities and knowledge

- [`@naro/tools`](../tools/README.md)
- [`@naro/environment`](../environment/README.md)
- [`@naro/context`](../context/README.md)
- [`@naro/memory`](../memory/README.md)

### Assurance and coordination

- [`@naro/policy`](../policy/README.md)
- [`@naro/verification`](../verification/README.md)
- [`@naro/observability`](../observability/README.md)
- [`@naro/evaluation`](../evaluation/README.md)
- [`@naro/multiagent`](../multiagent/README.md)

### Provider and protocol adapters

- [OpenAI-compatible](../adapters/openai/README.md)
- [Anthropic](../adapters/anthropic/README.md)
- [Gemini](../adapters/gemini/README.md)
- [MCP](../adapters/mcp/README.md)
- [OPA](../adapters/opa/README.md)
- [OTLP](../adapters/otel/README.md)
- [A2A](../adapters/a2a/README.md)

### Domain profiles

- [Coding](../profiles/coding/README.md)
- [Research](../profiles/research/README.md)
- [Browser](../profiles/browser/README.md)
- [Data](../profiles/data/README.md)
- [DevOps](../profiles/devops/README.md)
- [Workflow](../profiles/workflow/README.md)
- [Robotics](../profiles/robotics/README.md)

## Historical research

[Deep research report](deep-research-report.md) preserves the research and early
roadmap that informed Naro. It is historical input, not the current API
reference.
