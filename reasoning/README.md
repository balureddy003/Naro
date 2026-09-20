# @naro/reasoning

Pluggable reasoning strategies — how a model's capabilities get *used*.
The model answers; the reasoner decides when and why to ask.

## Strategies

| Class | Pattern | Behavior |
|---|---|---|
| `ReActReasoner` | ReAct | transcript → model → tool calls become actions; text = done |
| `PlanExecuteReasoner` | Plan-Execute | first call emits a JSON plan → tasks; then dispatches task-bound actions (`taskId`) |
| `ReflectionReasoner` | ReAct + self-critique | on failed observations, writes a lesson into later prompts |
| `DirectReasoner` (runtime) | scripted | the baseline — a function, no model |

## The seam

```ts
interface Reasoner { strategy: string; decide(ctx: ReasoningContext) → Decision }
```

`Decision` is closed: `plan | act | need-context | wait-for-human |
complete | fail`. Any strategy — these, tree search, a human — produces
only these, so the runtime never changes when strategies do.

## How they differ

Strategies differ mostly in *how they shape the transcript*
(`buildMessages` in `transcript.ts`): ReAct appends observations as tool
results; Reflection adds a "LESSONS FROM PRIOR FAILURES" section;
Plan-Execute asks for structured JSON once. Same evidence, different
thinking style.

## Requirements

- Model needs `chat` + `tool-calling` capabilities for ReAct/Reflection.
- Plan-Execute benefits from `structured-output` (falls back to JSON text).
