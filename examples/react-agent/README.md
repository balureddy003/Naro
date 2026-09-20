# react-agent

The next step after `minimal-agent`: the runtime is unchanged, but a
`ReActReasoner` now turns model tool calls into Naro actions.

The example stays offline. `MockModel` behaves like a provider long enough to
request the calculator, receive its result, and produce a final answer. Replace
it with a configured model adapter when you are ready to make network calls.

```bash
npm run example:react
```

## Read it in this order

1. **Goal and success criteria** define what “done” means.
2. **MockModel** returns a tool call first and an answer after it sees a tool
   result.
3. **Tool** declares its schema, permissions, side effects, and implementation.
4. **ContextEngine** and **MemoryStore** show where retrieved and retained
   information enter the reasoning context.
5. **ReActReasoner** translates model responses into the closed Naro `Decision`
   union.
6. **AgentRunner** applies policy, executes the tool, records the observation,
   verifies the result, and emits the trace.

## What to change next

- Replace `MockModel` with `OpenAiCompatibleProvider` and explicitly declare
  only the capabilities your selected model supports.
- Add a malformed tool call and watch schema validation reject it.
- Mark the calculator `destructive` and attach a `HumanBridge` to follow the
  approval path.
- Add a second context source and inspect which items survive the budget.
- Turn the scenario into an `EvalCase` so a prompt or model change cannot
  silently break it.

Keep the tool, policy, and verifier while swapping the model. That exercise is
the shortest demonstration of Naro's adapter boundary.
