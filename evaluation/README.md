# @naro/evaluation

Benchmarks and scoring — the answer to "did it get better, or did it just get different?"

## What it provides

- **`Benchmark`** — `{ name, cases }`; each case is `{ goal, run, expect }`
- **`runBenchmark()`** — executes cases, collects each run's `Event[]` stream, scores it
- **`scorer`** — pluggable `(case, events, result) → CaseScore`; the default extracts pass/fail, duration, tool-call count, token usage from the event stream via `metrics()`

## Why events, not internals

A benchmark judges a run the same way an auditor does — from the emitted evidence. That keeps evaluation honest: no peeking at runner internals, and the same scorer works on replayed historical streams.

## Invariants

- `expect` is an explicit predicate — a benchmark that can't say what "good" means isn't a benchmark.
- Scores are per-case, not averaged into mush: the report preserves per-case events for drill-down.

## Example

```ts
const report = await runBenchmark({
  name: 'arithmetic',
  cases: [{
    goal: mkGoal('add two numbers'),
    run: (g) => runner.run(g),
    expect: (r) => r.status === 'completed' && r.result === 42,
  }],
});
```
