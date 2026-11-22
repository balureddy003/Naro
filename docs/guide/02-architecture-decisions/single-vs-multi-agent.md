# Single-agent vs Multi-agent

## Decision tree

1. Can one agent with clear tools and a single goal achieve the outcome? → **Single agent**.
2. Do you need true parallel specialized work with different tool sets or risk profiles? → Consider multi-agent.
3. Is the coordination itself a source of failure (message loss, conflicting goals, unbounded delegation)? → Prefer single agent until coordination is proven.

## Trade-offs

| | Single agent | Multi-agent |
|--|--------------|-------------|
| Complexity | Lower | Higher (buses, identity, depth limits) |
| Audit | One journal | Multiple journals + correlation |
| Failure modes | Tool misuse | Plus coordination and delegation bugs |
| When it wins | Most production systems | Specialized parallel work with strong boundaries |

## Naro realization

- Single agent is the default path (`AgentRunner`).
- Multi-agent is available via `@naro/multiagent` with policy-gated delegation, depth caps, capability allowlists, and grant subsets.
- Recommendation: start single; add multi-agent only when the single-agent design is blocked by specialization or parallelism requirements.

See also: [Multi-agent systems](../../learn/09-multi-agent.md).
