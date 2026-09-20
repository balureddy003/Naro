# minimal-agent

The whole Naro loop in ~100 lines — no API keys, no network.

```bash
npm run example    # from repo root
```

What it does, and what it teaches:

| Line block | Concept |
|---|---|
| `createGoal` | goals carry successCriteria a verifier can check |
| `MockModel` | the stack runs fully offline; real models are drop-in |
| `Tool` + `ToolRegistry` | capabilities with schemas and side-effect metadata |
| `InMemoryEnvironment` | the world — one key-value env stands in for any domain |
| `DirectReasoner` | the strategy seam — decide(ctx) → Decision |
| `Verifier` | evidence decides "done", not the model |
| `CompositeExecutor` | `tool://` → tools, `env://` → environment |
| `createToolPolicy` | every action passes the permission gate |
| `runner.on('*')` | the event stream IS the audit/UI/debug surface |
| `FileCheckpointStore` | each cycle checkpoints — crash, resume, keep going |

Read `src/index.ts` top-to-bottom — the comments are the tutorial.
