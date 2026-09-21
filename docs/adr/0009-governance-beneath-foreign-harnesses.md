# 0009 — Governance beneath foreign harnesses

Status: accepted
Date: 2026-09-29

## Context

The coding-harness market converged on the same surface — every serious
harness fires pre/post tool-use hooks. Claude Agent SDK exposes
`PreToolUse`/`PostToolUse` with `permissionDecision`; OpenCode plugins get
`tool.execute.before/after`. Meanwhile Naro's moat is not its loop but what
surrounds actions: the required policy gate, the verifier, and the
hash-chained journal.

If those mechanisms can ride *underneath* a foreign harness, a team keeps
its harness and gains Naro's evidence trail — the positioning claim becomes
true in both directions.

## Decision

`@naro/adapter-harness` ships `HarnessKernel` plus thin, structural shape
mappers (`claudeHooks`, `openCodePlugin`). The kernel translates a foreign
tool call into a Naro `Action`, evaluates the configured `PolicyEngine`,
journals `action.requested → permission.requested → permitted|denied`, and
joins the post-execution result by call id into `action.completed` +
`observation.created`. `endSession` optionally runs a `Verifier` over the
claimed outcome — a false completion claim ends the foreign run as failed
evidence, same as in-kernel.

The mappers are structural: they implement the *shape* of each harness's
hook contract without importing the SDK, so the package needs no vendor
dependency and the harnesses stay free to evolve.

## Alternatives considered

- **Vendor each SDK as a dependency.** Rejected: heavy install graph,
  version coupling, and blocked by nothing more than structural typing —
  the hook contracts are plain objects.
- **Wrap the harness in a subprocess and parse its event stream.**
  Rejected as the primary path: parsing stdout gives observability without
  a gate — you cannot deny a tool call that already ran. Hook injection is
  the control point. (A stream mapper remains possible for harnesses
  without hooks, as an observe-only mode.)
- **Proxy the model API instead.** Rejected: sees messages, not tool
  semantics; and a proxy breaks provider features (prompt caching,
  streaming fidelity) that the harness relies on.

## Consequences

- `naro verify` and `buildEvidence` work on foreign runs — the moat travels.
- Governance covers *actions*, not model internals: a harness that ignores a
  deny verdict is out of scope; the journal records the verdict regardless.
- 'ask' degrades to deny on harnesses without an approval path (OpenCode) —
  surfaced in the error message, not silently.
- Codex CLI has no documented tool-call hook today; it is covered only when
  one lands. No claim otherwise.
