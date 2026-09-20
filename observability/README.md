# @naro/observability

Metrics, redaction, and durable export derived from the same event journal the
runtime returns.

## Public API

| Export | Role |
|---|---|
| `computeMetrics(events)` | derives behavior and duration from an event history |
| `EventExporter` | batch sink contract with optional `flush()` |
| `JsonlExporter` | ordered append-only JSONL audit file |
| `ConsoleExporter` | compact development stream |
| `SqliteEventStore` | transactional, queryable single-host event journal |
| `pipeTo(bus, exporter)` | attaches a live exporter and returns `stop()` plus `flush()` |
| `redact()` / `redacting()` | masks sensitive keys and secret-shaped values before export |

## Live export

```ts
const store = new SqliteEventStore('.naro/events.db');
const tap = pipeTo(runner, redacting(store));

const result = await runner.run();
await tap.flush();
tap.stop();
```

The runner's internal event history remains complete. Redaction wraps the
external exporter boundary.

## Event guarantees

- payloads are immutable structured-clone snapshots;
- `seq` is monotonic within a run;
- `runId` identifies one logical run and survives checkpoint resume;
- subscriber exceptions do not crash execution;
- JSONL, SQLite, and OTLP exporters serialize writes;
- exporter failures surface through `flush()`.

`SqliteEventStore.history()` filters by agent or run. `runs()` lists known runs
for audit and operational tooling.

## Metrics

`AgentMetrics` currently includes event count, reasoning iterations, actions,
denials, approval requests, observations, verification pass/fail counts,
replans, checkpoints, and event-stream duration.

The runtime emits `model.usage` and includes totals on terminal events. Those
fields are present in the journal, but `computeMetrics()` does not yet aggregate
token or cost totals into `AgentMetrics`.

## OpenTelemetry

`@naro/adapter-otel` maps events to OTLP/HTTP log records. Events are facts in
sequence, not a parented timing tree, so the adapter does not invent spans.
