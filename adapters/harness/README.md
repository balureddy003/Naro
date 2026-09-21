# @naro/adapter-harness

Governance beneath foreign agent harnesses — keep Claude Agent SDK or
OpenCode's model, tools, and UI; gain Naro's policy gate, verifier, and
hash-chained journal.

## The shape

```ts
const kernel = harnessKernel({ agentId: 'my-agent', goal: 'assist', policy });

// Claude Agent SDK — options.hooks
const hooks = claudeHooks(kernel);
//   PreToolUse  → kernel.gateTool()  → permissionDecision allow/deny/ask
//   PostToolUse → kernel.observeTool() → journaled observation

// OpenCode — a plugin factory
export const Governed = openCodePlugin(kernel);
//   tool.execute.before → throws on deny (OpenCode's block mechanism)
//   tool.execute.after  → kernel.observeTool()
```

The kernel maps every foreign tool call to a Naro `Action`, evaluates it
against your `PolicyEngine`, and journals the verdict — denied calls are
evidence too. Results land as `Observation`s, `endSession` optionally runs a
`Verifier` over the claimed outcome, and the whole journal is hash-chained:
`naro verify run.jsonl` works on runs Naro did not drive.

## Honest scope

- The kernel governs **actions**, not the harness's internals. Model calls
  that produce no tool use are invisible to it.
- A harness that ignores a deny verdict defeats the gate — the journal still
  records the verdict, which is the audit trail's job.
- 'ask' maps to the harness's own approval UI where one exists (Claude SDK's
  `permissionDecision: 'ask'`); OpenCode has no ask path, so
  `require_approval` surfaces as a deny carrying the reason.
- `signals` and secrets never cross a boundary; see ADR 0008 for the same
  rule on remote environments.
