# Model Neutrality

## Decision

Should the runtime be locked to one model provider or remain neutral?

## Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| Single provider | Simpler adapters, vendor features | Lock-in, harder to switch or fail over |
| Neutral (capability-gated) | Swap or fail over models; avoid lock-in | Must abstract capabilities; some vendor features unused |

## Recommendation

Prefer neutrality unless a specific vendor feature is a hard requirement that cannot be approximated. Neutrality also makes evaluation and cost control easier (you can route by price or quality).

## Naro realization

- Model and ModelProvider ports.
- Adapters for OpenAI-compatible, Anthropic, and Gemini.
- Capability gating so the runtime only uses features the model actually supports.
- Failover composition across providers.

See also: architecture model section.
