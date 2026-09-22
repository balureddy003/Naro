# @naro/adapter-pg

Postgres-backed durable ports — the multi-host tier. Any process that can
reach the database shares checkpoints, events, memory, leases, quotas, the
task queue, the run registry, and the human-approval queue.

## Usage

```ts
import { pgPool, PgCheckpointStore, PgAgentBus, PgLeaseStore, PgLimitStore, PgEventStore, PgMemoryStore, PgRunRegistry, PgApprovalBridge } from '@naro/adapter-pg';

const pool = await pgPool(process.env.DATABASE_URL!);
const checkpoints = await PgCheckpointStore.create(pool);
const bus = await PgAgentBus.create(pool);
```

`pg` is an optional peer dependency — install it where you deploy:
`npm i pg`. Every store takes a `PgQueryable` (one `query(text, params)`
method — `pg.Pool`, `pg.Client`, or a `PoolClient` all satisfy it), so
tests can substitute any queryable.

## Correctness primitives

- `PgAgentBus` claims with `FOR UPDATE SKIP LOCKED` — each task lands on
  exactly one worker; stale claims are reclaimed by age.
- `PgLimitStore` quotas are single-statement `UPSERT … RETURNING`
  counters — two hosts cannot both slip under the cap.
- `PgLeaseStore` acquires via a conditional `ON CONFLICT` upsert — atomic
  compare-and-set, no transaction dance.
- `PgEventStore` batches as one multi-row `INSERT` — atomic without an
  explicit transaction.
- `PgApprovalBridge.respond` is a conditional `UPDATE … WHERE answered_at IS
  NULL AND expires_at > now()` — two replicas racing to answer the same
  approval can't both win, and an expired request can't be answered late.

Tables are `naro_*`-namespaced and self-created on `create()`.

## Testing

Integration tests require `NARO_PG_URL` (e.g.
`postgres://postgres:postgres@localhost:5432/naro_test`) and are skipped
without it. CI runs them against a Postgres service container.
