# @naro/evaluation

A small benchmark harness for answering one question: did the agent get better,
or did it merely change?

## Public API

- `EvalCase` combines a goal, agent dependencies, and an optional outcome check.
- `BenchmarkRunner.run(cases)` executes each case through a real `AgentRunner`.
- `EvalResult` preserves status, score, result, reason, and event-derived metrics.
- `EvalReport` contains per-case results and aggregate behavior totals.
- `formatReport(report)` produces a compact summary for terminal and CI logs.

```ts
const report = await new BenchmarkRunner().run([
  {
    id: 'arithmetic',
    goal: createGoal({ description: 'Return 42' }),
    deps: { reasoner, executor, policy, verifier },
    check: (run) => run.status === 'completed' && run.result === 42,
  },
]);

console.log(formatReport(report));
```

## Why metrics come from events

Each case runs through the production runtime. The harness scores the returned
`RunResult`, while `@naro/observability` derives iterations, actions, denials,
replans, checkpoints, and duration from the same ordered event history used for
audit and debugging.

There is no separate evaluation-only execution path to drift away from reality.

## Training data export

`exportTrainingExamples(events, options?)` turns a run's event stream into an
SFT-ready `TrainingExample` — the exact `ChatMessage[]` transcript a model
would have seen, built by `@naro/reasoning`'s `buildMessages()` (the same
renderer a live run uses, not a second one to keep in sync). Only runs whose
completion was verified (`buildEvidence(...).goalVerification.ok === true`)
are included by default:

```ts
const result = await runner.run();
const examples = exportTrainingExamples(result.events);
await writeFile('dataset.jsonl', toJsonl(examples));
```

Naro's thesis is that a claim without verification isn't evidence — that
applies doubly to data used to train a model. Pass `{ verifiedOnly: false }`
to export unverified runs too (auditing failures, not building a training
set).

## Current scope

Cases run sequentially and once each. The caller owns repeated sampling,
parallelism, persistence, model-judge calibration, and regression thresholds.
The report keeps every case result so failures can be inspected instead of
being hidden behind one average.
