# 0016 — Tool definitions from untrusted sources are provenance-pinned

Status: accepted
Date: 2026-09-23

## Context

ADR 0010 made evidence *origin* a policy input: an `Observation` returned
by a tool call carries `trust`, and a policy can deny a destructive action
triggered by external-trust evidence. That closes the classic prompt
injection path — a fetched page or tool *result* talking the model into
something it shouldn't do.

It does not cover a related, now well-documented attack class against
MCP specifically: a malicious or compromised server changing a tool's
*definition* — its `description` or `inputSchema` — rather than its
output. Two named patterns, both current in 2026 MCP security research
(NSA/CISA's MCP security guidance, the Cloud Security Alliance's "MCP
Security Crisis" research note, and independent scans finding the
majority of public MCP servers carry exploitable flaws — see
[docs/adr/README.md](README.md) for how this record fits alongside
0010; sources are external and cited in the PR, not reproduced here):

- **Tool poisoning** — a tool's `description` string is itself untrusted
  content fed into the model's context at `decide()` time, before any
  action runs. Naro's provenance mechanism protects `Observation`s;
  `McpToolSource.discover()` (`adapters/mcp/src/mcp-source.ts`) copies
  `t.description` verbatim into `Tool.description` with no trust marker
  at all — the model reads it as ordinary tool metadata, identically to a
  locally-authored tool.
- **Rug pulls** — a server changes a previously-approved tool's
  description or schema between one `registry.refresh()` and the next.
  `McpToolSource.discover()` re-fetches `listTools()` and rebuilds every
  `Tool` from scratch on every call; nothing compares today's definition
  against what was last seen, so an operator who reviewed and approved a
  tool once has no signal that its actual behavior contract changed.

Both gaps exist specifically because `Tool.trust` (`tools/src/tool.ts`)
today marks the trust of a tool's *output*, not its *definition* — the
two are conflated as one field covering only the runtime-observation
half of the surface ADR 0010 named.

## Decision

1. `Tool` gains an optional `definitionHash` (computed by the tool
   source, not hand-set) — a stable hash over `{ name, description,
   inputSchema }` for tools sourced from anything other than
   process-local code (`McpToolSource` and any future remote
   `ToolSource` compute it; hand-authored local tools do not need one).
2. `ToolRegistry` records the `definitionHash` last seen per tool name
   across `refresh()` calls. A tool whose hash changed from a
   previously-seen value is not silently swapped in: the registry emits a
   `tool.definition.changed` observation-shaped event (old hash, new
   hash, tool name, source id) and, under the baseline `createToolPolicy`,
   the changed tool defaults to `destructive` (forcing re-approval)
   regardless of its previous side-effect classification, until an
   operator acknowledges the change.
3. A `Tool.description` sourced from `trust: 'external'` is delimited in
   the transcript the same way `Observation` content already is per ADR
   0010 (`UNTRUSTED OUTPUT` framing) — the model sees it labeled as
   external-authored metadata, not as an ordinary tool contract, closing
   the tool-poisoning path at the same layer 0010 closed it for results.

## Alternatives considered

- **Trust the transport (TLS/mTLS) as sufficient.** Rejected: transport
  security authenticates the server, not the content it chooses to send
  — a legitimately-connected, unmodified server can still serve a
  poisoned or rug-pulled tool definition; this is an application-layer
  problem, not a transport one.
- **Require operators to pin an allowlist of exact tool schemas out of
  band (config file, manual review only).** Rejected as the *only*
  mechanism: worth documenting as a stronger option for high-assurance
  deployments, but the kernel should detect and gate a definition change
  by default — an operator who never wrote an allowlist should not be
  silently unprotected, mirroring why ADR 0010 made provenance a runtime
  default rather than an opt-in review process.
- **Hash the whole discovered tool list as one blob, not per-tool.**
  Rejected: a one-tool change on a twenty-tool server would force
  re-approval of all twenty, training operators to click through the
  prompt without reading it — the same alert-fatigue failure mode
  `denyExternalTriggered` was scoped narrowly to avoid in ADR 0010.
- **Auto-deny any hash change outright, no re-approval path.** Rejected:
  legitimate servers do update tool descriptions (bug fixes, clarified
  parameters); the kernel's job is to surface the change as a decision a
  human or policy makes, not to make MCP servers unable to ship updates.

## Consequences

- Closes the one gap ADR 0010's "Uniqueness" claim
  ([docs/market-quadrant.md](../market-quadrant.md)) didn't yet cover:
  provenance now applies to tool *definitions*, not only tool *output* —
  the two halves of "what a compromised MCP server can hand the model"
  are both gated the same way.
- `ToolRegistry` needs persistent state across `refresh()` calls (last-seen
  hash per tool name, per source) that did not exist before — an
  in-memory map is sufficient for a single process; a multi-host
  deployment sharing one registry's view needs this backed by the same
  store class already used for other cross-process state (the registry's
  choice, not a new kernel port).
- `McpToolSource` and any future non-local `ToolSource` must compute
  `definitionHash` honestly (excluding volatile fields, if any) — a
  source that gets this wrong either false-flags every refresh (alert
  fatigue) or never flags a real change (silent bypass); this is exactly
  the kind of thing `@naro/contract-tests` should assert for any
  `ToolSource` implementation going forward.
- Local, hand-authored tools are unaffected: no `definitionHash`, no
  change detection, nothing new to configure — this is additive to
  externally-sourced tools only.
