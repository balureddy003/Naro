# Multi-agent Coordination

## When to use

Only after a single-agent design is blocked by genuine specialization or parallelism needs. Coordination adds failure modes.

## Safety boundaries

| Boundary | Purpose | Naro mechanism |
|----------|---------|----------------|
| Depth cap | Prevent infinite delegation | Policy-gated delegation limits |
| Capability allowlist | Child cannot exceed parent rights | Grant subset |
| Scoped context | Child sees only what it needs | Context scoping |
| Policy on delegate tool | Delegation itself is authorized | Same policy engine |
| Separate journals + correlation | Audit each agent | Per-run journals |

## Patterns

- **Orchestrator + workers** — one agent delegates bounded tasks.
- **Specialist hand-off** — explicit transfer with reduced grants.
- **Avoid** — free-form agent meshes with no depth or capability limits.

## Naro realization

`@naro/multiagent` provides directory, buses (local/HTTP/durable/A2A), and policy-gated `delegate` with depth caps, capability allowlists, and grant subsets.

## Anti-patterns

- Delegation without a depth limit.
- Child agent receiving the full parent grant set.
- No correlation ID across journals.

See also: [Single vs multi-agent decision](../02-architecture-decisions/single-vs-multi-agent.md).
