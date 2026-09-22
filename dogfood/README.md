# @naro/dogfood

Naro governing its own development. Not a published package — internal
tooling that runs Claude Code sessions working on *this* repository
through Naro's own `@naro/adapter-harness` policy gate and journal.

## Why

Every claim this project makes about governance — a required policy gate,
a hash-chained journal, `naro verify` working on runs Naro didn't drive
— is easiest to trust when it's demonstrably running against something
real. This repo is the something real: `.claude/settings.json` wires
Claude Code's own `PreToolUse`/`PostToolUse` hooks through this package,
so a coding-agent session editing Naro's source is itself an instance of
`docs/use-cases.md`'s "multi-agent delegation" and "coding agent" use
cases, governed the way the docs describe.

## How it fits together

```
Claude Code (this session) ──tool call──▶ .claude/hooks/*.mjs ──HTTP──▶ dogfood/src/server.ts
                                                                              │
                                                                    HarnessKernel.gateTool()
                                                                    (dogfoodPolicy, @naro/policy)
                                                                              │
                                                                   .naro/dogfood-journal.jsonl
                                                                    (hash-chained, naro verify)
```

`server.ts` holds one `HarnessKernel` for the life of the Claude Code
session — necessary because each hook invocation is a fresh subprocess
(see `adapters/harness/src/claude.ts`'s doc comment), so the kernel that
joins a `PreToolUse` gate verdict to its `PostToolUse` result by call id
has to live somewhere that survives across those subprocess boundaries.
A loopback HTTP server is that somewhere — the same shape as
`serveEnvironment`/`HttpEnvironment` (ADR 0008), applied to the harness
adapter instead of an `Environment`.

## Policy

`src/policy.ts` governs `Bash` calls only (see `profiles/coding`'s own
"shell.exec is the dangerous one" — the same reasoning applies here). It
denies force-push, `git reset --hard`, hook/signature bypass flags, and
repo-root-shaped `rm -rf`; requires approval for pushing to `main`,
publishing, and merging PRs; and audits (allows, but journals) everything
else. Read/Edit/Write are out of scope for v1 — reversible via git, and
already covered by Claude Code's own permission system.

This mirrors, structurally, the "Git Safety Protocol" this session's own
system prompt already asks a model to remember — the difference is that
the gate runs whether or not the model recalls the rule.

## Endpoints

- `POST /pre` — `ClaudePreToolInput` in, `ClaudeHookOutput` out (gate).
- `POST /post` — `ClaudePostToolInput` in, `{}` out (observe).
- `POST /end` — `{ result?, error?, cancelled? }` in, ends the session.
- `GET /health` — liveness for the `SessionStart` hook.

## Honest scope

Same limits as `@naro/adapter-harness` generally, plus:

- **Fail-open by design.** `.claude/hooks/pre-tool-use.mjs` allows the
  call through if the server is unreachable or errors — a bug here must
  never be able to lock out a Claude Code session on this repo. This is
  an audit-and-advise layer today, not a hard security boundary; see
  `SECURITY.md` before treating it as one.
- **FIFO correlation, not exact.** Claude Code's hook JSON isn't
  documented to carry a stable per-call id, so `PostToolUse` joins to
  the *oldest* still-pending gated action (`HarnessKernel`'s documented
  fallback). Correct for sequential tool calls; a batch of parallel
  calls of the same tool can misattribute observations to the wrong
  action id. The gate decision itself is never affected — only which
  action a result's evidence record joins to.
- **Single session, single journal file.** `.naro/dogfood-journal.jsonl`
  is overwritten fresh per `SessionStart`, not append-only across
  sessions. Keep exported journals elsewhere if you want to retain them.

## Try it

```bash
node dogfood/src/server.ts &         # starts on an OS-assigned port, prints it
PORT=$(cat .naro/dogfood.port)
curl -s -X POST "http://127.0.0.1:$PORT/pre" \
  -d '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}'
# → {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",...}}
kill %1
naro verify .naro/dogfood-journal.jsonl
```
