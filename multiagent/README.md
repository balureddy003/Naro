# @naro/multiagent

The A2A seam: agents address each other by id over a replaceable bus. Naro's kernel stays single-agent — coordination lives at the edge.

## The design trick: delegation is a tool

`delegationTool(bus, agentId)` produces a standard `Tool` whose `execute()` sends a task request over the bus. Consequence: delegation flows through the same `resolve → authorize → validate → execute → observe` pipeline as everything else — policy can gate which agents may be addressed, humans can approve cross-agent calls, and every delegation lands in the event audit trail.

```ts
const bus = new InMemoryAgentBus();
const dir = new AgentDirectory();
dir.register({ id: 'researcher', name: 'Researcher', capabilities: ['web'] });

// Worker side: serve requests with a real AgentRunner
bus.serve('researcher', async (msg) => (await runner.run(msg.goal)).result);

// Parent side: the model can call `delegate` like any tool
registry.register(delegationTool(bus, 'parent', dir));
```

## Components

- **`AgentBus`** — `serve(agentId, handler)` + `request(to, goal)` request/reply. Two transports: `InMemoryAgentBus` (same process) and `HttpAgentBus` (`POST /agents/{id}/task` — real cross-process delegation, `resolve(agentId) → base URL`).
- **`AgentDirectory`** — capability-indexed registry so a reasoner (or the delegation tool) can find who can do what.
- **`AgentMessage`** — `task-request` / `task-result` / `status` union, extensible toward full A2A semantics.

## Invariants

- The kernel knows nothing about other agents — `core` has no multi-agent types.
- Unknown agents fail visibly (`unknown agent 'x'`), never silently queue.
- Bus timeouts are explicit — a worker that never replies surfaces as a failed observation, not a hung run.
