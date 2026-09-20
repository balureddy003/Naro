# Naro Architecture

Four C4 views: who Naro serves → what it's made of → how the parts connect →
what happens during one agent step.

## C4 Level 1 — System Context

Naro sits between **people** (who set goals and approve actions), **models**
(who supply intelligence), and **the world** (environments, tools, data):

```mermaid
C4Context
    title Naro — System Context
    Person(dev, "Developer / Operator", "defines goals, approves actions, audits runs")
    System(naro, "Naro", "universal agent foundation: primitives + runtime + adapters")
    System_Ext(models, "Model Providers", "OpenAI / Anthropic / Ollama / vLLM / any endpoint")
    System_Ext(envs, "Environments", "repos, browsers, clusters, databases, robots")
    System_Ext(tools, "Tool Sources", "MCP servers, REST/GraphQL APIs, CLIs")
    System_Ext(obs, "Observability", "OpenTelemetry, logs, dashboards")
    Rel(dev, naro, "goals, approvals, policies")
    Rel(naro, models, "chat / embed / stream (capability-gated)")
    Rel(naro, envs, "actions in, observations out")
    Rel(naro, tools, "schema-validated calls")
    Rel(naro, obs, "structured events, traces")
```

## C4 Level 2 — Containers (packages)

Each box is a separately testable, separately replaceable package.
Arrows only ever point *toward* `core` — nothing upstream depends on anything.

```mermaid
C4Container
    title Naro — Package View
    Container(core, "@naro/core", "types", "Goal · Task · Action · Observation · Events · 18-state machine · Reasoner/Policy/Verifier/Context/Executor seams")
    Container(runtime, "@naro/runtime", "engine", "AgentRunner · EventBus · retry/timeout · checkpoint+recovery")
    Container(model, "@naro/model", "interface", "Model · ModelProvider · MockModel")
    Container(tools, "@naro/tools", "interface", "Tool · Registry · schema validation · executor pipeline")
    Container(env, "@naro/environment", "interface", "Environment · InMemoryEnvironment")
    Container(memory, "@naro/memory", "store", "Tiered MemoryStore · in-memory + JSONL")
    Container(context, "@naro/context", "pipeline", "retrieve → rank → select → budget")
    Container(reasoning, "@naro/reasoning", "strategies", "ReAct · PlanExecute · Reflection over Model")
    Container(policy, "@naro/policy", "governance", "PolicyEngine · rules-as-data · rate limiting")
    Container(obs, "@naro/observability", "telemetry", "Event exporters · metrics() · JSONL audit")
    Container(evaluation, "@naro/evaluation", "scoring", "Benchmark harness · event-stream scorers")
    Container_Boundary(adapters, "Adapters") {
      Container(mcp, "@naro/adapter-mcp", "", "MCP ToolSource")
      Container(oa, "@naro/adapter-openai", "", "OpenAI-compatible Model/Provider")
    }
    Rel(runtime, core, "drives")
    Rel(model, core, "contracts")
    Rel(tools, core, "contracts")
    Rel(env, core, "contracts")
    Rel(adapters, core, "implements")
```

## C4 Level 3 — Components (the runtime's inner loop)

```mermaid
C4Component
    title AgentRunner — one reasoning cycle
    Component(runner, "AgentRunner", "", "owns ALL state transitions; enforces the loop")
    Component(reasoner, "Reasoner", "interface", "ctx → Decision (plan/act/need-context/wait/complete/fail)")
    Component(policy, "PolicyEngine", "interface", "allow | deny | require_approval")
    Component(exec, "ActionExecutor", "interface", "action → observation (tool://, env:// routes)")
    Component(verifier, "Verifier", "interface", "evidence over assertion")
    Component(ckpt, "CheckpointStore", "interface", "reasoning-boundary snapshots")
    Component(bus, "EventBus", "", "ordered event log + subscriptions")
    Rel(runner, reasoner, "decide(ctx)")
    Rel(runner, policy, "evaluate(action)")
    Rel(runner, exec, "execute(action)")
    Rel(runner, verifier, "verify(...)")
    Rel(runner, ckpt, "save() per cycle")
    Rel(runner, bus, "emits everything")
```

## C4 Dynamic — one act→observe→verify step

```mermaid
sequenceDiagram
    participant R as AgentRunner
    participant B as Reasoner
    participant P as PolicyEngine
    participant X as Executor (tool/env)
    participant V as Verifier
    participant E as EventBus

    R->>B: decide(ctx) — REASONING
    B-->>R: { kind:'act', action }
    R->>P: evaluate(action) — WAITING_FOR_PERMISSION
    alt denied
        P-->>R: deny → action.denied event → observation → REASONING
    else approval needed
        P-->>R: require_approval → WAITING_FOR_HUMAN → human → back to gate
    else allowed
        R->>X: execute(action) — ACTING
        X-->>R: Observation (errors are observations, never crashes)
        R->>V: verify(observation) — VERIFYING
        alt failed
            V-->>R: ok=false → REPLANNING → REASONING
        else ok
            V-->>R: ok=true → REASONING (loop)
        end
    end
    R->>E: every step emits events + checkpoint
```

## The rules that keep it universal

1. **Core knows no domains.** If a concept wouldn't make sense to a robot *and*
   a researcher *and* a coder, it doesn't belong in `core/`.
2. **Every decision path is observable.** No silent fallbacks — missing
   capabilities throw, denied actions produce observations, everything emits.
3. **Checkpoints happen only at reasoning boundaries** — an action is never
   half-restored.
4. **Policy is structural.** `REASONING → ACTING` is not a legal transition;
   the only path runs through `WAITING_FOR_PERMISSION`.
