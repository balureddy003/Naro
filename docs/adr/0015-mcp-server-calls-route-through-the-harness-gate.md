# 0015 — Naro-as-MCP-server routes calls through the harness gate

Status: proposed
Date: 2026-09-23

## Context

`@naro/adapter-mcp` works in both directions: `McpToolSource` lets a Naro
agent call tools on someone else's MCP server (governed — see ADR 0010,
every result lands as `trust: 'external'`), and `McpRegistryServer` lets
someone else's MCP host (Claude Code, Cursor, another agent) call *Naro's*
tools (`adapters/mcp/README.md`: "Naro isn't just an agent runtime, it's a
tool provider on the standard wire").

The second direction does not carry Naro's own guarantees. Reading
`adapters/mcp/src/mcp-server.ts`: the `CallToolRequestSchema` handler
resolves a tool from the registry and calls `tool.execute(req.params.arguments,
this.ctx())` directly. That is the same `tool.execute()` `ToolExecutor`
calls — but `ToolExecutor` is reached only after `AgentRunner` has already
evaluated `PolicyEngine`, entered `WAITING_FOR_PERMISSION`, and recorded
`action.requested → permission.requested → permitted|denied` (`tools/src/executor.ts`'s
own doc comment: "Authorization happens upstream — the runner's PolicyEngine
gates every action before it reaches an executor"). `McpRegistryServer`
skips straight to the executor's job with no upstream gate and no
`EventBus` in the loop at all: no policy verdict, no `action.completed`, no
`observation.created`, nothing for `naro verify` to chain.

This contradicts [docs/positioning.md](../positioning.md)'s own claim —
"every action is authorized before it runs and verified after" — and
[docs/principles.md](../principles.md)'s Security rule ("every action
passes `WAITING_FOR_PERMISSION`") for exactly the surface where an
*external* caller, not Naro's own reasoner, is the one invoking the tool.
An MCP host is precisely the least-trusted caller of the two — the one a
gate exists for — and it is the one direction with no gate.

The mechanism to close this already exists: ADR 0009's `HarnessKernel`
translates a foreign tool call into a Naro `Action`, evaluates the
configured `PolicyEngine`, journals the verdict, and joins post-execution
into `action.completed` + `observation.created` — built for exactly this
shape (a foreign caller invoking tools through a hook), just written for
Claude Agent SDK's and OpenCode's hook contracts rather than MCP's
`CallToolRequestSchema`/`ListToolsRequestSchema`.

## Decision

`McpRegistryServer` gains a required `HarnessKernel` (or an equivalent
policy-gated call path) and routes every inbound `tools/call` through it
instead of calling `tool.execute()` directly: translate the MCP call into
an `Action`, run `kernel.handleCall()` (or the equivalent `HarnessKernel`
entry point), and map the resulting verdict/observation back into the
MCP response shape (`isError: true` with the denial reason on a policy
deny, the observation's output on success). `ListToolsRequestSchema`
stays as-is — listing tool metadata is not an action and needs no gate.

This is the same decision ADR 0009 already made, applied to the one
inbound surface that was missed when it shipped. No new kernel primitive.

## Alternatives considered

- **Leave it as documented ("authorization stays with whatever policy
  gates the caller's actions upstream").** Rejected: that phrasing reads
  as a deliberate boundary, but it is not one Naro states anywhere else —
  every other adapter (`@naro/adapter-harness`, `McpToolSource` itself)
  gates the call *Naro* is responsible for, and here Naro is the callee.
  An MCP host with no tool-call hook of its own (unlike Claude Agent SDK)
  would get zero governance, silently.
- **A lighter, bespoke gate just for `McpRegistryServer`** (call
  `PolicyEngine.evaluate()` and emit two or three events by hand, skip
  `HarnessKernel`). Rejected: it would re-derive `HarnessKernel`'s
  action-shape mapping and event sequence with a second, slightly
  different implementation to keep in sync — the whole point of ADR 0009
  was one kernel for every foreign-call shape.
- **Require a full `AgentRunner` per inbound call.** Rejected: there is no
  goal, plan, or reasoning loop around a single external tool invocation
  — `HarnessKernel` already exists precisely because gating a call needs
  policy + journal, not the full state machine.

## Consequences

- `naro verify` and `buildEvidence` now cover calls arriving over MCP,
  matching every other adapter surface — closes the one asymmetry in
  "Naro gives MCP first-class treatment," which today is true only for
  outbound (`McpToolSource`), not inbound (`McpRegistryServer`).
- An MCP host that ignores a deny verdict is out of scope, same caveat as
  ADR 0009 — the journal records the verdict regardless of whether the
  caller respects it.
- `McpRegistryServer`'s constructor signature changes (a `HarnessKernel`
  or policy dependency becomes required, not optional) — a breaking
  change to `@naro/adapter-mcp`'s public API, needs a changeset and a
  README update (`adapters/mcp/README.md`'s "what Naro gives MCP" claim
  becomes true in both directions instead of one).
- `ctxFactory`'s role narrows: it still maps an incoming call to an
  `ExecContext` for the executor, but authorization no longer depends on
  whatever the caller does with that context — the gate runs regardless.
