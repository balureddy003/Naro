# 0019 — Memory writes are provenance-tagged

Status: proposed
Date: 2026-09-23

## Context

ADR 0010 made evidence origin a policy input for `Observation`s. ADR 0016
(proposed) extends the same idea to tool *definitions*. Both exist because
letting untrusted content influence the model's next decision with no
trust marker is the mechanism behind the highest-volume attacks on
tool-using agents.

`@naro/memory` is the one evidence surface this thesis hasn't reached yet.
Reading `memory/src/store.ts`: `MemoryEntry`/`MemoryInput` carry `source?:
string` — "memory should always know where it came from," per the field's
own doc comment — but no `trust` field. A memory written from content
that originated in an `external`-trust observation (a fact extracted from
a fetched web page, a summary of an email, a "lesson learned" derived from
a tool result) is stored and later recalled with no marker distinguishing
it from a system-authored fact. `textScore`/`search`/`searchTier` treat
every entry identically; nothing downstream — a reasoner's prompt
assembly, a `PolicyContext` — can ask "was this recalled memory ever
externally sourced."

This is not a hypothetical extrapolation of ADR 0010's thesis. OWASP's
2026 Agentic AI Top 10 names memory/context poisoning as ASI06
specifically, and its prescribed defense stack leads with "memory
sanitization with provenance" and "trust-aware retrieval" — independent
research (MINJA and related memory-injection studies) demonstrates
injected memories persisting across sessions and triggering days or
weeks after the poisoning interaction, which is a materially worse
outcome than a single-turn prompt injection: the poisoned content
survives the run that encountered it and returns as "recalled context"
in a *later*, otherwise-unrelated run, at which point provenance from
the original run is long gone unless it was captured at write time.

Memory writing in Naro is application-driven, not kernel-automatic:
`AgentRunner` does not call `MemoryStore.write()` on every observation —
an application or reasoner does, explicitly (see `examples/react-agent/src/index.ts`).
That matters for the shape of the fix: there is no single kernel choke
point to intercept, unlike `ToolExecutor`'s `Tool.trust` default. The fix
has to make trust a first-class, easy-to-pass field at the one call every
writer already makes, not a kernel-enforced default.

## Decision

1. `MemoryEntry`/`MemoryInput` gain an optional `trust?: TrustLevel`
   (`@naro/core`'s existing `system | tool | external`, not a new type),
   defaulting to `undefined` (treated as unknown-trust, not silently
   `system`-trusted — an application that doesn't set it gets no false
   assurance either way).
2. `createMemoryEntry` propagates `trust` from `MemoryInput` unchanged —
   purely additive, no behavior change for existing callers who don't
   set it.
3. `MemoryHit` (the read-side type `MemoryReader.search`/`searchTier`
   return) surfaces `trust` alongside each entry, so a reasoner assembling
   a prompt from recalled memories can render the same `UNTRUSTED OUTPUT`
   framing ADR 0010 already gives external observations — recalled
   external-trust memory is delimited the same way a live external
   observation is, not silently blended into "what the agent knows."
4. **No automatic write-time inference.** The runner does not guess a
   memory's trust from whatever observation prompted the write — that
   would require kernel-level memory writing, which this codebase
   deliberately doesn't have. Applications that write memories derived
   from observations are expected to pass the observation's `trust`
   through explicitly; `@naro/reasoning`'s reference reasoners that do
   write memory should be updated to do this by example, documented as
   the pattern rather than enforced by the kernel.

## Alternatives considered

- **Make the runner auto-write memory on every observation, now with
  trust inferred automatically.** Rejected: this would be a much larger
  change to Naro's memory model (memory writing becoming kernel-owned
  instead of application-owned) justified by a problem (missing
  provenance) that doesn't require it — the same proportionality
  reasoning ADR 0014 used to reject a new runtime state for escalation.
- **A separate "quarantine" tier for externally-sourced memories instead
  of a `trust` field on every tier.** Rejected: `MemoryTier` already
  encodes *lifetime and purpose* (working/session/episodic/semantic/
  procedural/longterm); overloading it to also encode trust conflates
  two independent axes — an episodic memory can be externally sourced
  just as easily as a semantic one.
- **Trust decays or is stripped on read, so old memories default back to
  neutral over time.** Rejected as a default: silently forgetting where a
  fact came from is the opposite of what provenance is for. A deployment
  wanting time-based trust decay can build it as a policy on top of the
  field this ADR adds; the kernel doesn't do it automatically.

## Consequences

- Closes the one evidence surface ADR 0010's thesis didn't yet cover —
  `Observation` (0010), `Tool` definitions (0016, proposed), and now
  `MemoryEntry` all carry the same three-level trust vocabulary.
- `MemoryStore` implementations (`InMemoryStore`, `FileMemoryStore`,
  `SqliteMemoryStore`, and `@naro/adapter-postgres`'s Postgres-backed
  store) need a schema/column addition for `trust`, additive and
  nullable — `contract-tests/src/memory-store.ts` should assert the
  roundtrip the same way it does for every other field.
- Applications and reference reasoners that write memory from observation
  content need updating to actually pass `trust` through — this ADR adds
  the field; it does not retrofit every existing memory-writing call
  site, which remains real follow-up work.
- Recall-time rendering (prompt assembly) changes to grade memory the
  same way transcript rendering already grades live observations —
  a small, mechanical change once the field exists, not a new mechanism.
