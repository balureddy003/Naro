# @naro/reasoning

Reasoning strategies decide how models and evidence are turned into Naro's
closed `Decision` protocol. Strategies never execute capabilities directly.

## Strategies

| Class | Pattern | Behavior |
|---|---|---|
| `ReActReasoner` | ReAct | model tool calls become actions; text becomes a completion claim |
| `PlanExecuteReasoner` | plan/execute | emits structured tasks, then dispatches task-bound actions |
| `ReflectionReasoner` | ReAct + critique | adds evidence-backed lessons after failures |
| `TreeSearchReasoner` | bounded search | expands and scores simulated decisions before choosing one |
| `DirectReasoner` in runtime | scripted | deterministic function without a model |

## Decision protocol

```text
plan | act | act-batch | need-context | wait-for-human | complete | fail
```

Multiple tool calls from `ReActReasoner` become `act-batch`. The runtime gates
each call serially, then executes authorized calls concurrently.

## ReAct options

```ts
const reasoner = new ReActReasoner(model, {
  tools,
  instructions,
  maxObservations: 20,
  onChunk: (chunk) => renderToken(chunk.delta),
});
```

When `onChunk` is configured and the model declares `streaming`, chunks are
forwarded live and folded back into the normal response used to make the
decision. Provider usage becomes `Decision.usage`, which the runtime records as
`model.usage` events.

`maxObservations` bounds the evidence window. It does not summarize discarded
observations; choose a value that fits the provider context and task.

## Checkpoint state

Strategies with internal state implement `StatefulReasoner`:

```ts
interface StatefulReasoner extends Reasoner {
  captureState(): unknown;
  restoreState(state: unknown): void;
}
```

The runtime stores that value in checkpoints and restores it on resume.
`ReActReasoner` is currently stateless between decisions because all tool calls
from one response dispatch as one action or atomic batch.

## Requirements

- ReAct and Reflection need `chat`; tool use also needs `tool-calling`.
- Streaming callbacks require `streaming`.
- Plan-Execute benefits from `structured-output` and can fall back to JSON text.
- Multi-ply tree search requires a simulator; depth greater than one without a
  world model fails rather than pretending to predict consequences.
