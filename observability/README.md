# @naro/observability

Event-derived metrics, traces, and audit export — the answer to "what actually happened."

## What it provides

- **`EventExporter`** — sink interface; `JsonlExporter` writes the ordered event stream to disk (replayable, greppable, diffable)
- **`metrics(events)`** — pure function: event stream → `RunMetrics` (duration, action/tool counts, success rates, token usage summed across model calls, per-tool breakdown, states visited)
- **`attachConsole(exporter)`** — trivial live-tap for development

## Why event-derived

The runtime already emits a complete ordered event log — observability adds **interpretation**, not instrumentation. No probes, no side-channels: if it happened, it's in the stream; if it's in the stream, it's in the metrics.

## Invariants

- `metrics()` is pure and deterministic — same events → same numbers.
- `JsonlExporter.flush()` must be awaited before process exit; `export()` queues writes to preserve order under concurrency.
- The exporter seam is where an OpenTelemetry adapter lands: same events, OTLP out.

## Example

```ts
const exporter = new JsonlExporter('.naro/audit.jsonl');
runner.on('*', (e) => exporter.export(e));
const result = await runner.run(goal);
await exporter.flush();
console.log(metrics(runner.eventBus.history));
```
