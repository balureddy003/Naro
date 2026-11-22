# Naro

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](package.json)
[![Stars](https://img.shields.io/github/stars/balureddy003/Naro?style=social)](https://github.com/balureddy003/Naro/stargazers)

**The evidence-gated agent kernel.**  
Every action is authorized before it runs and verified after. A run is not complete until the kernel has evidence.

Naro is an open-source runtime that makes authorization, verification, and audit structural — not optional middleware. The model proposes; the runtime authorizes, executes, observes, and checks.

```
 Goal ──► Reasoner ──► Decision ──► WAITING_FOR_PERMISSION ──► ACTING
   ▲                     (claim)         policy gate               │
   │                                                               ▼
 REPLANNING ◄── VERIFYING ◄── OBSERVING ◄── Environment / Tool ◄───┘
                   │
                   └──► immutable event journal (audit · resume · eval · UI)
```

> Most agent projects fail between demo and production because of governance, verification, and ownership gaps — not model quality. Naro is built to close those gaps.

## Why Naro

| Problem | How Naro solves it |
|---------|-------------------|
| Agents can self-authorize | Required policy gate on every action |
| No proof the outcome was correct | Verification is a runtime state + evidence record |
| Impossible to audit later | Hash-chained immutable journal + `naro verify` |
| Prompt injection drives side effects | Provenance-aware policy |
| Regressions ship silently | `naro bench --baseline` gates CI |

**New:** [AI System Engineering Guide](docs/guide/README.md) — ground-up patterns, architecture decisions, and explicit mapping to industry production gaps. Naro is the reference implementation.

## Quickstart

```bash
git clone https://github.com/balureddy003/Naro.git
cd Naro
npm install
npm run example      # watch a full safe agent loop
npm run check        # build + test everything
```

Minimal agent:

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

## How Naro differs

| | Orchestration frameworks | Security kernels | Harness SDKs | **Naro** |
|---|---|---|---|---|
| Agent loop | yes | middleware only | fixed | 17-state machine |
| Policy gate | opt-in | yes | vendor model | **required** |
| Verification as state | build it | no | no | **yes** |
| Intent / evidence split | messages | audit log | messages | **Action vs Observation** |
| Model neutrality | yes | yes | single vendor | yes + failover |
| Regression gates in CI | external | no | no | **`naro bench --baseline`** |

## Learn & Build

- **[AI System Engineering Guide](docs/guide/README.md)** — start here for patterns and production gaps
- [Build your first safe agent](docs/getting-started.md) (~15 min)
- [Learning course](docs/learn/) (00–12)
- [Architecture](docs/architecture.md) · [Use cases](docs/use-cases.md) · [Production readiness](docs/production-readiness.md)

## Star, Clone, Contribute

If Naro helps you build governable agents:

- **Star** the repo — it helps others discover it
- **Clone** and run the examples
- **Contribute** — good first issues, docs, new profiles, or adapters are welcome

See [CONTRIBUTING.md](CONTRIBUTING.md) for the short path to your first PR.

## Status

`0.1.0` — solid kernel and guide, not yet published to npm. Actively developed.

## License

Apache-2.0 — see [LICENSE](LICENSE).
