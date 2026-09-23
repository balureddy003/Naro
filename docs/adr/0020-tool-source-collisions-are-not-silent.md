# 0020 — Tool name collisions across sources are policy-visible, not silent

Status: proposed
Date: 2026-09-23

## Context

ADR 0016 (proposed) detects a *known* tool's definition changing between
refreshes — a rug pull. It does not cover a related pattern: a *second*
source registering a tool under a name a *different* source already
provided. Reading `tools/src/registry.ts`: `ToolRegistry.register(tool)`
does `this.tools.set(tool.name, tool)` unconditionally — no check for
whether `tool.name` already exists, no comparison of which source
provided the existing entry, no event. `refresh()` iterates every
registered `ToolSource` in order and calls `register()` for everything
each one discovers; whichever source is iterated last, or whichever
server responds with a matching tool name on a later `refresh()` call,
silently becomes the active definition for that name.

This is "cross-server tool shadowing" — the same MCP-security research
that names tool poisoning and rug pulls (ADR 0016's context) also
documents this as a distinct pattern: a malicious or compromised MCP
server registers a tool sharing a trusted server's tool name (`search`,
`read_file`, `execute`), and depending on discovery order, its version is
the one actually invoked when the model calls that name — with no
observable difference to the model, which only ever sees the winning
`Tool.description`. Unlike a rug pull (the same source changing over
time), this needs no compromise of the trusted server at all — only a
second source willing to claim the same name.

## Decision

`ToolRegistry.register()` gains collision awareness:

1. When `register(tool)` is called for a name already present, and the
   existing entry's source differs from the new one (tracked via a
   required `sourceId` parameter — every `ToolSource.discover()`'s
   results are registered with that source's `id`, never anonymously),
   the registry does not silently overwrite. It keeps the
   *first-registered* source's tool active, records the collision (a
   `tool.collision.detected` event: both source ids, the tool name,
   both `definitionHash`es if available per ADR 0016), and requires
   explicit resolution — an operator/policy call to
   `registry.resolve(name, sourceId)` — before the shadowing source's
   version can ever become active for that name.
2. A collision between two `Tool`s registered by the *same* source
   across `refresh()` calls is not a collision at all — that is exactly
   ADR 0016's rug-pull case, handled there.
3. Local, hand-registered tools (via `register()` called directly, not
   through a `ToolSource`) keep today's behavior: no source id, no
   collision tracking, since there is no ambiguity about who defined
   them.

## Alternatives considered

- **First-registered source always wins, silently, no event.** Rejected:
  this is closer to today's behavior (whichever source discovers first
  currently wins only by accident of registration order) but gives no
  operator any signal that a second source *tried* to claim a trusted
  name — the collision itself is the thing worth knowing about,
  independent of which side wins.
- **Namespace every tool by source automatically** (`mcp-a:search`,
  `mcp-b:search`), eliminating collisions structurally. Rejected as the
  default: it would change every existing `tool://<name>` action target
  and model-facing tool name for every deployment, a much larger
  compatibility break for a problem collision-detection solves without
  renaming anything. Worth documenting as an opt-in `ToolRegistry` mode
  for a deployment with many sources that wants it, not the default.
- **Compare tool descriptions/schemas for similarity to guess which one
  is legitimate.** Rejected: heuristic legitimacy scoring is exactly the
  kind of guess ADR 0016 already rejected for tool-definition trust — the
  registry's job is to surface the fact of a collision to something that
  can make an authorized decision (an operator, a policy rule), not to
  guess on their behalf.

## Consequences

- Closes the second half of the "compromised or malicious MCP server"
  threat model ADR 0016 opened: mutation of a known tool (rug pull) and
  impersonation of a known tool's name (shadowing) are both now visible,
  not just the first.
- `ToolRegistry.register()`'s signature changes to require a source
  identifier for anything registered through `addSource`/`refresh()` — an
  additive change for `ToolSource` implementations (they already have
  `id`), a compatibility note for any code calling `register()` directly
  outside that path.
- An unresolved collision means the second source's tool is simply
  unavailable for that name until resolved — fails closed, consistent
  with every other undecided-trust default in this codebase (ADR 0010's
  provenance denial, ADR 0016's forced re-approval).
- `toolSourceContract` (`@naro/contract-tests`) gains an assertion that
  two sources registering the same tool name produce a collision event,
  not a silent overwrite.
