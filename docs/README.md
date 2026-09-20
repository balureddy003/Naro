# Naro Documentation

Use the documentation by outcome, not by file order.

## I want to understand agent systems

Follow the course in `learn/`:

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

The course starts with model behavior and ends with production operation. Each
chapter explains the concept, its failure modes, and where Naro implements it.

## I want to build an agent

Start with a runnable example:

| Level | Example | What it teaches | Run |
|---|---|---|---|
| 1 | [minimal agent](../examples/minimal-agent/README.md) | goal, decisions, tools, policy, observations, checkpoints | `npm run example` |
| 2 | [ReAct agent](../examples/react-agent/README.md) | model tool calls, context, memory, verification | `npm run example:react` |
| 3 | [coding agent](../examples/coding-agent/README.md) | a real domain profile with jailed files and shell | `npm run example:coding` |

Then choose a production-shaped recipe from [Use cases](use-cases.md): coding,
research, browser automation, data, DevOps, deterministic workflow, robotics,
or multi-agent delegation.

## I want to understand or extend Naro

- [Architecture](architecture.md) moves from system context to packages,
  runtime behavior, deployment, and code-level invariants.
- [Design principles](principles.md) is the review checklist for changes.
- [Contract tests](../contract-tests/README.md) explains how replacement
  implementations prove compatibility.
- Package READMEs document the public API and local trust boundary of each
  package.

Before adding a new abstraction, use the placement table in
[Architecture: code-level extension rules](architecture.md#15-code-level-extension-rules).

## I want to operate and evaluate agents

- Use `runner.events()` for a live async event stream.
- Export events through JSONL, console, or
  [`@naro/adapter-otel`](../adapters/otel/README.md).
- Use [`@naro/evaluation`](../evaluation/README.md) for cases, reports,
  persistence, and baseline diffs.
- Use [`naro bench`](../cli/README.md) as a CI regression gate.
- Use [`@naro/adapter-opa`](../adapters/opa/README.md) when policy must be
  centrally managed in Rego.

## Historical research

[Deep research report](deep-research-report.md) records the research and early
roadmap that informed Naro. It is historical design input, not the current API
reference. Current behavior is documented in package source, package READMEs,
and `architecture.md`.
