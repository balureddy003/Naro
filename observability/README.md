# @naro/observability

Event-derived metrics and export for answering a practical question: what
actually happened during this run?

## Public API

- `computeMetrics(events)` derives counts and duration from a completed event
  history.
- `EventExporter` is the sink contract for batches of `NaroEvent` values.
- `JsonlExporter` appends one JSON object per line to a file.
- `ConsoleExporter` prints a compact live event stream.
- `pipeTo(bus, exporter)` forwards each live event and returns an unsubscribe
  function.

```ts
const exporter = new JsonlExporter('.naro/audit.jsonl');
const unsubscribe = pipeTo(runner, exporter);
const result = await runner.run();
unsubscribe();

console.log(computeMetrics(result.events));
```

## Metrics available today

`AgentMetrics` includes total events, reasoning iterations, requested and
denied actions, approval requests, observations, verification pass/fail counts,
replans, checkpoints, and event-stream duration.

The function is pure: the same events produce the same metrics. Token and cost
metrics require corresponding model-usage events; the current runtime event
vocabulary does not emit those yet.

## Exporter behavior

`JsonlExporter.export()` returns a promise. Callers that invoke it directly
should await it. `pipeTo()` is intended as a lightweight live tap; applications
that require durable delivery, batching, backpressure, or error reporting
should implement `EventExporter` with those guarantees.

An OpenTelemetry exporter can use the same interface without changing the
runtime.
