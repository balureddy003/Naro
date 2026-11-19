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

## Span export (ADR 0021)

`OtlpSpanExporter` is the additive second mode — the GenAI semantic-convention
span view (`/v1/traces`), composable with the log exporter on the same stream:

```ts
import { OtlpSpanExporter } from '@naro/adapter-otel';

const spans = new OtlpSpanExporter({ endpoint, serviceName: 'naro-agent' });
const tap = pipeTo(runner, spans);   // or compose both exporters
```

Mapping:

| Naro concept | Span |
|---|---|
| run (`runId`) | one `invoke_agent <agentId>` span, `goal.started` → terminal event |
| action (`action.id`) | `execute_tool <target>` span; `action.denied` ends it immediately as error — its duration is gate latency, not execution |
| `NaroEvent.traceId` | OTLP `trace_id` — delegated child runs share the parent's trace and nest under the parent's open `delegate` span when the pairing is identifiable |
| reasoning iterations, `model.usage`, verification | span *events* on the agent span — no third span level in v1 |

Attributes follow the GenAI draft conventions (`gen_ai.operation.name`,
`gen_ai.tool.name`, `gen_ai.usage.*`, `error.type`) plus `naro.*` join keys
(`naro.runId`, `naro.action.id`, `naro.policy.verdict`).

## Invariants

- Batches preserve `seq` order (serialized write queue, like `JsonlExporter`).
- Export failures surface on `flush()` — telemetry must never swallow its own errors.
- `fetchImpl` injectable — tests assert the exact OTLP payload offline.
