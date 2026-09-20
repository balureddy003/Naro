# @naro/tools

Tools are capabilities with contracts — declarative metadata + one `execute`.

## What's inside

| Export | Role |
|---|---|
| `Tool` | name, description, `inputSchema`/`outputSchema`, `permissions`, `sideEffects`, `execute` |
| `ToolRegistry` | name → tool catalog; merges `ToolSource`s |
| `ToolSource` | discovery port — where MCP/local/remote catalogs plug in |
| `JsonSchema`, `validate()` | zero-dep schema subset (swap ajv/zod behind the same calls) |
| `ToolExecutor` | `resolve → validate → execute → validate → observe` — implements `ActionExecutor` |
| `createToolPolicy` | baseline `PolicyEngine` from tool metadata |

## The lifecycle

Every `tool://` action runs:

```
resolve (registry) → authorize (runner's policy gate) → validate input
→ execute → validate output → Observation (success or honest failure)
```

Tool errors produce `success:false` observations — the reasoner learns
the tool failed instead of the run crashing.

## Writing a tool

```ts
const myTool: Tool = {
  name: 'deploy', description: 'deploy a service',
  inputSchema: { type: 'object', properties: { svc: { type: 'string' } }, required: ['svc'] },
  permissions: ['deploy.write'],     // agent must hold this grant
  sideEffects: 'write',              // 'destructive' → human approval
  execute: async (input, ctx) => { /* honor ctx.signal */ },
};
```

Be honest in `sideEffects` and `permissions` — policy is only as good as
your metadata.
