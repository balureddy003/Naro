# Data-Contract Strictness

## Spectrum

| Level | Description | When to use |
|-------|-------------|-------------|
| Loose | Free-form text, best-effort parsing | Early exploration only |
| Schema | JSON Schema or equivalent on inputs and outputs | Default for any tool or final result |
| Predicate + Schema | Schema plus business rules | Production default |
| Full contract + provenance | Schema, predicates, trust levels, and allowlists | High-stakes or external data |

## Recommendation

Start at Schema. Move to Predicate + Schema before any production traffic. Add provenance and allowlists as soon as the agent consumes external or untrusted content.

## Naro realization

- Schema, predicate, and composite verifiers.
- Observation.trust and provenance-aware policy.
- Environment contracts in domain profiles (path jails, destination allowlists, read-only SQL, declared runbooks).

See also: [Output contracts](../03-production-gaps/output-contracts.md), [Data and integration](../03-production-gaps/data-and-integration.md).
