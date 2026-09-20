# @naro/profile-data

A data agent's world: one SQL connection, parameterized queries only.

## The port

`SqlDriver` — `query / exec / schema / close`. `NodeSqliteDriver` ships real SQL in-process via `node:sqlite` (zero external deps). Postgres/MySQL adapters satisfy the same contract.

## Capabilities — the read/write split is structural

| Capability | Statements | Side effect |
|---|---|---|
| `sql.query` | SELECT / WITH / EXPLAIN / PRAGMA only | read |
| `sql.exec` | INSERT / UPDATE / DELETE / DDL | write — gate with policy |
| `sql.schema` | table/column inventory | read |

The split is enforced inside the environment by statement classification — a `sql.query` action containing `DELETE` fails before it reaches the driver. An agent that should never write simply isn't granted `sql.exec`.

## Invariants

- **Parameterized params only** — `{sql, params}` binds values; interpolation never reaches SQL.
- **Row caps** — `maxRows` truncates honestly (`truncated: true, totalRows`).
- `sql_schema` is a first-class capability: agents should inventory before querying.
- node:sqlite null-prototype rows are normalized to plain objects.
