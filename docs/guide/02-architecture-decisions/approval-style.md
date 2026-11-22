# Sync vs Async Approval

## Options

| Style | When it fits | Operational cost | Naro support |
|-------|--------------|------------------|--------------|
| Synchronous (human blocks the run) | Low volume, high risk, interactive sessions | Higher latency | `HumanBridge` |
| Asynchronous (approval persisted, run resumes) | Higher volume, durable workflows | Requires persistence and notification | SQLite/Postgres approval stores; run can be woken from journal |
| Pre-approved grants / limits | Well-bounded autonomous actions | Must be carefully scoped | Policy grants, quotas, allowlists |

## Recommendation

- Start with synchronous approval for any irreversible action.
- Move to durable async approval when volume or multi-host deployment requires it.
- Prefer pre-approved limits over broad autonomy.

See also: [Governance and Autonomy](../03-production-gaps/governance-and-autonomy.md).
