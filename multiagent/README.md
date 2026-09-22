# @naro/multiagent

Agent addressing and delegation outside the single-agent kernel. Delegation is
a normal tool call, so grants, policy, validation, observations, and audit still
apply.

## Core contract

```ts
interface AgentBus {
  serve(agentId, handler): void;
  request(to, goal, from, timeoutMs?): Promise<unknown>;
}
```

`AgentDirectory` records agent identity and advertised capabilities.
`delegationTool()` exposes the bus through a tool requiring the
`agent.delegate` permission.

## Included transports

| Transport | Scope | Delivery |
|---|---|---|
| `InMemoryAgentBus` | one process | direct request/reply |
| `HttpAgentBus` | processes or hosts | synchronous HTTP request/reply |
| `DurableAgentBus` | processes sharing one SQLite file | persistent at-least-once queue |

`@naro/adapter-a2a` implements agent cards and the synchronous JSON-RPC
`tasks/send` subset over the same `AgentBus` contract.

## HTTP authentication

`HttpAgentBus` accepts a `TokenVerifier`:

- `sharedTokenVerifier()` for a constant-time shared secret;
- `hmacTokenVerifier()` for HS256 JWT verification with expiry, issuer, and
  audience checks;
- an application-supplied verifier for OIDC/JWKS or another identity system.

Configure `authenticate` on the server and `tokenProvider` on the caller for
rotating credentials. Once authentication is configured, missing or invalid
bearer tokens fail closed with `401`.

## Durable delegation

```ts
const bus = new DurableAgentBus('.naro/agents.db', {
  pollMs: 25,
  reclaimAfterMs: 30_000,
});
```

Requests are SQLite rows. Pending work survives process restart. Claims older
than `reclaimAfterMs` return to the queue, which gives at-least-once delivery.
A handler can therefore run more than once and must make external writes
idempotent.

A requester timeout marks the task `timed-out`; work already claimed may still
finish. `tasks()` exposes queue state for operations and forensics.

## Example

```ts
const directory = new AgentDirectory();
directory.register({ id: 'researcher', name: 'Researcher', capabilities: ['research'] });

const bus = new InMemoryAgentBus();
bus.serve('researcher', async (message) => runSpecialist(message.goal));
registry.register(delegationTool(bus, 'lead', directory));
```

## Correlating parent and child journals

Each delegated agent has its own runId and its own independently hash-chained
journal — delegation never merges chains. To still answer "which child runs
belong to this parent's request," `delegationTool()` stamps the parent's
`ExecContext.traceId` onto the child goal's metadata
(`naro:traceId`). The receiving side reads it back through
`delegationConstraints()` and passes it into the child's own run:

```ts
bus.serve('researcher', async (message) => {
  const { traceId } = delegationConstraints(message.goal);
  const runner = new AgentRunner({ spec: specFor(message.goal), /* … */ });
  return runner.run({ traceId }); // omit to let the child start its own trace
});
```

A root run's `traceId` defaults to its own `runId`, so every run — delegated
or not — always carries one. `traceId` is correlation metadata, not part of
the hash chain: verifying either journal never depends on it.

## Boundaries

- Select context for the child; do not copy the parent transcript wholesale.
- Apply delegation depth, token, time, and cost budgets.
- Authenticate and encrypt network transports.
- Verify child output before trusting it.
- SQLite durability is single-host; multi-host queues need a shared database or
  broker implementation behind `AgentBus`.
