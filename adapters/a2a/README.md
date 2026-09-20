# @naro/adapter-a2a

A2A (Agent2Agent) protocol transport for `AgentBus` — spec-shaped agent discovery + task delegation.

## What it adds beyond raw HTTP

- **Agent Cards** at `GET /.well-known/agent.json` — discoverable identity + skills. This is how agents find each other without a shared registry.
- **JSON-RPC task methods** — `tasks/send`, `tasks/get`, and `tasks/cancel`.
- **SSE `message/stream`** — lifecycle frames for submitted, working, and terminal task state.

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

`requestStream()` reports task lifecycle, not incremental model tokens or
artifacts: the current `AgentBus` handler returns one result. Cancellation marks
a stored task canceled; application handlers need their own cancellation path
to stop work already running. Push notifications and multi-turn task graphs are
not implemented. Bearer tokens are supported; TLS/mTLS remain deployment
concerns.
