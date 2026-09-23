# Naro Documentation

Three tracks, one codebase. Pick the one that matches what you're actually
trying to do today — you can switch tracks any time, and every page links
back to this one.

| Track | You're here if… | Start here |
|---|---|---|
| 🟢 **Beginner** | You want to understand agent loops, or you're new to Naro specifically, and you learn best building something small first | [Build your first safe agent](getting-started.md), then the learning course ([00](learn/00-how-llms-work.md) → [12](learn/12-scale-and-reliability.md)) in order |
| 🟡 **Practitioner** | You already know what an agent loop is; you're integrating Naro into a real coding/research/data/devops system | [End-to-end use cases](use-cases.md) → the profile README for your domain → [production readiness](production-readiness.md) before you ship — and read [agent loops](learn/08-agent-loops.md) and [security and policy](learn/11-security-and-policy.md) for two defaults that bite in production: verification is skipped entirely with no verifier configured, and the baseline policy allows non-tool schemes by default |
| 🔴 **Expert** | You're extending the kernel, writing a new adapter or port, or deciding whether to bet a system on Naro at all | [Architecture](architecture.md) → [ADRs](adr/README.md) → [positioning](positioning.md) + [market quadrant](market-quadrant.md) |

The tracks are entry points, not tiers of importance — a practitioner
debugging a replan loop ends up on the same [agent loops](learn/08-agent-loops.md)
page a beginner started with, and an expert reviewing a PR still opens
[use-cases.md](use-cases.md) to check a claim against a real composition.
They *are* different in depth by design: the beginner track is a 13-chapter
course because a newcomer needs the scaffolding, and the other two tracks
are short because they assume it. If a page below feels like it's missing
context, that's the signal to detour into the course rather than push
through — the two callouts above exist because skipping straight to
production readiness would otherwise miss them.

## Get started (🟢 beginner entry point)

New to Naro:

1. [Build your first safe agent](getting-started.md) — offline, policy-gated,
   verified, and observable. ~15 minutes, nothing to install beyond Node.
2. [Glossary](glossary.md) — the vocabulary used throughout the project.
   Keep it open in a tab; every other page assumes these terms.
3. [How LLMs work](learn/00-how-llms-work.md) — begin the concept course.

Runnable examples — the learning course's "Try it" sections below all
point back at these same five, one or two at a time as each chapter
needs them, rather than introducing new ones:

| Level | Example | Run | Used by |
|---|---|---|---|
| 1 | [Minimal agent](../examples/minimal-agent/README.md) | `npm run example` | 00, 03 |
| 2 | [ReAct agent](../examples/react-agent/README.md) | `npm run example:react` | 02, 03 |
| 3 | [Coding agent](../examples/coding-agent/README.md) | `npm run example:coding` | 05 |
| 4 | [Governed agent](../examples/governed-agent/README.md) | `npm run example:governed` | 08, 11, 12 |
| 5 | [Research agent](../examples/research-agent/README.md) | `npm run example:research` | 04, 11 |

## Tutorials and use cases (🟡 practitioner entry point)

[End-to-end use cases](use-cases.md) covers production-shaped compositions for:

- coding;
- cited research;
- browser automation;
- SQL and data;
- DevOps runbooks;
- deterministic workflows;
- robotics;
- multi-agent delegation;
- governing a foreign coding harness (Naro governing its own development).

Each use case names its capabilities, controls, evidence, and production
boundary — start with the "composition checklist" at the top of the page,
then jump straight to your domain. You don't need the learning course
below to use this page; it links back to the concept it assumes wherever
one matters.

## Learn the concepts (🟢 beginner track)

The learning course moves from model mechanics to production operation.
Each page is 5–10 minutes and ends with a "try it" pointing at a runnable
example, plus a short self-check so you know whether to move on or
reread. Read them in order the first time through — 08 (agent loops)
assumes 00–07, and 11–12 assume 08–10:

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

## Architecture and design (🔴 expert entry point)

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
- [CLAUDE.md](../CLAUDE.md) — the context `RepoContextSource` (and any
  Claude Code session) reads for this repo; also this project's own
  extension-rules/review-invariants checklist in one place.
- [`dogfood/`](../dogfood/README.md) — Naro governing its own development:
  this repo's own policy gate and journal running beneath Claude Code's
  hooks. See use case 10 in [use-cases.md](use-cases.md).
- [Documentation style](documentation-style.md) — page types, voice, claim
  standards, and maintenance checklist.
- [EU AI Act Article 12 mapping](compliance/eu-ai-act-article-12.md) — what
  the evidence architecture already gives a regulated buyer, and the one
  gap (retention policy) it doesn't yet.

## Operations and production (🟡 practitioner: pre-ship checklist)

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

Every track ends up here — this is the lookup table, not a reading order.

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
