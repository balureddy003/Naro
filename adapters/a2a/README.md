# @naro/adapter-a2a

A2A (Agent2Agent) protocol transport for `AgentBus` — spec-shaped agent discovery + task delegation.

## What it adds beyond raw HTTP

- **Agent Cards** at `GET /.well-known/agent.json` — discoverable identity + skills. This is how agents find each other without a shared registry.
- **JSON-RPC 2.0 `tasks/send`** — synchronous task delegation returning `completed`/`failed` task states with result artifacts.

```ts
// worker side
const bus = new A2aAgentBus({ resolve: (id) => endpoints.get(id) });
bus.advertise({ name: 'worker', skills: [{ id: 'math', name: 'Math', description: 'arithmetic' }], ... });
bus.serve('worker', async (msg) => runSubtask(msg.goal));
await bus.listen(9100);

// caller side — same AgentBus contract
const result = await bus.request('worker', goal, 'parent-agent');
```

`cardToDescriptor()` turns a fetched card into an `AgentDirectory` entry — discovery and routing compose.

## Scope honesty

This is the synchronous subset: cards + `tasks/send`. SSE streaming, push notifications, and multi-turn task graphs are spec features layered on later — the `AgentBus` seam doesn't change. Optional bearer token; TLS/mTLS are deployment concerns.
