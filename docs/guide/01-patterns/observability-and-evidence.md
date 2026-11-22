# Observability and Evidence

## Principle

Logs and metrics tell you the system is running. Evidence tells you whether the agent did the right thing and why.

## What to capture

| Signal | Purpose | Must be immutable? |
|--------|---------|--------------------|
| Policy verdict | Authorization audit | Yes |
| Action (intent) | What was attempted | Yes |
| Observation (evidence) | What actually happened | Yes |
| Verifier verdict | Whether the claim was accepted | Yes |
| Metrics (latency, tokens, cost) | Operations and optimization | No (aggregates fine) |

## Naro realization

- Hash-chained journal is the source of truth.
- Evidence record joins the four items above for every action and for completion.
- `naro verify` recomputes the chain and validates the evidence record.
- Observability package exports to JSONL, SQLite, Postgres, or OTLP; redaction is available.

## Anti-patterns

- Treating application logs as the audit trail.
- Metrics without the ability to reconstruct a single run.
- Evidence that can be edited after the fact.

See also: [Verification Gap](../03-production-gaps/verification-gap.md), [Observability package](../../observability/README.md).
