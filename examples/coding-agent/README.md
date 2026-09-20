# coding-agent

A complete domain-profile example: a ReAct agent reads a real temporary
workspace, runs a bounded command, and reports the result.

```bash
npm run example:coding
```

No API key or network is required. `MockModel` supplies deterministic tool calls
so you can study the runtime rather than provider setup.

## What to follow

1. A temporary workspace is created with `answer.txt`.
2. `WorkspaceEnvironment` jails file and command access to that directory.
3. `codingTools(env)` exposes filesystem and shell capabilities through tool
   schemas.
4. `ReActReasoner` converts model tool calls into Naro actions.
5. `CompositeExecutor` routes `tool://` and `env://` targets.
6. Policy runs before each action.
7. Every state change, action, and observation appears in the event stream.

## What this example does not claim

It uses `allowAllPolicy` to keep the trace focused. Do not copy that policy into
production. A real coding agent should use a disposable checkout or sandbox,
require approval for shell and destructive writes, attach checkpoints, and
verify completion with tests or another trusted command.

## Next exercises

- Replace `allowAllPolicy` with a rule policy that allows reads and requires
  approval for `shell.exec`.
- Add `CommandVerifier('npm test', { cwd })`.
- Consume `runner.events()` with `for await` instead of a callback.
- Export the trace to JSONL and inspect it with `naro replay`.
- Turn the goal into an `EvalCase` and compare it with a saved baseline.
