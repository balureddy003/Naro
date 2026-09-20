# @naro/adapter-otel

OTLP/HTTP exporter — Naro's event stream lands in your existing telemetry pipeline (otel-collector, Jaeger, Grafana, Honeycomb). No OTel SDK; raw fetch like every other adapter.

## Usage

```ts
import { pipeTo } from '@naro/observability';
import { OtlpExporter } from '@naro/adapter-otel';

const otel = new OtlpExporter({
  endpoint: process.env.OTLP_ENDPOINT ?? 'http://localhost:4318',
  serviceName: 'naro-agent',
  headers: { authorization: `Bearer ${process.env.OTLP_TOKEN}` },
});
const tap = pipeTo(runner, otel);   // every event → /v1/logs
await runner.run();
await tap.flush();
```

## Mapping

Events export as **OTLP log records** — `body` = event type, attributes carry `seq`, `agentId`, `goalId`, and the full `data` payload. Severity: failures/denials/approvals/replans → WARN/ERROR, lifecycle → INFO.

Why logs not spans: events are ordered facts, not a trace tree — mapping them into spans would invent parentage the stream doesn't carry. When events gain span/timing structure, honest span mapping can be added.

## Invariants

- Batches preserve `seq` order (serialized write queue, like `JsonlExporter`).
- Export failures surface on `flush()` — telemetry must never swallow its own errors.
- `fetchImpl` injectable — tests assert the exact OTLP payload offline.
