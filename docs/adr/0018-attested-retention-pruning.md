# 0018 — Retention pruning is an attested chain re-anchor, not deletion

Status: proposed
Date: 2026-09-23

## Context

[docs/compliance/eu-ai-act-article-12.md](../compliance/eu-ai-act-article-12.md)
named the one real gap in Naro's evidence architecture against Article
12: no store enforces or supports a retention *ceiling*. `SqliteEventStore`
(`observability/src/sqlite-event-store.ts`) and `PgEventStore` keep every
event forever; nothing prunes, and nothing could prune safely today even
if an operator wanted to, because the hash chain (`core/src/chain.ts`)
verifies from the first event forward — deleting early rows breaks
`prev`/`hash` continuity for everything after them, and `naro verify`
would report a broken chain indistinguishable from tampering.

That last point matters more than it looks: an operator who deletes old
rows directly against the database today, for entirely legitimate
data-minimization reasons (GDPR storage limitation runs alongside the AI
Act's obligations, not instead of them), leaves a journal that *looks*
tampered. The kernel has no vocabulary for "these events were removed on
purpose, under a stated policy, at a stated time" — only for "the chain
doesn't verify."

The fix does not require new cryptographic machinery.
`verifyChain(events, { expectPrev })` (`core/src/chain.ts`) already
verifies a chain starting from a non-genesis anchor — built for resumed
runs whose journal continues from a checkpoint's chain head. Sealing
(`signHead`/`verifySeal`, `core/src/sign.ts`) already proves a chain head
existed under a specific key at a specific time. Retention pruning is a
recombination of both, not a new mechanism.

## Decision

1. A new terminal-shaped, non-terminal event type,
   `journal.retention.pruned: { prunedThroughSeq: number; anchorHash:
   string; prunedAt: number; policy?: string; signature?: string;
   publicKey?: string }`. `anchorHash` is the `hash` of the last event
   being removed — the value every surviving event's chain must now
   treat as its starting `prev`. When a `sealKey` is configured, the
   event is signed the same way `journal.sealed` is: proof that a
   specific key-holder attested to this exact prune, not a bare claim.
2. A `naro prune --run <id> --before <seq|date> [--reason <policy
   citation>]` CLI command, backed by an optional `prune(runId,
   throughSeq)` capability on `EventStore` implementations (not added to
   the base `EventStore`/`CheckpointStore` contracts every store must
   implement — an separate, optional capability, the same way `embed()`
   is an optional `ModelCapability` rather than a required `Model`
   method). It: computes `anchorHash` from the last event being removed,
   writes the `journal.retention.pruned` event as the new first row,
   deletes the pruned rows, and refuses if the target run is not in a
   terminal state (pruning an active run's early events would break
   `wake(runId)`'s ability to rebuild session state per ADR 0007).
3. `verifyChain` recognizes a journal whose first event is
   `journal.retention.pruned` and verifies from `anchorHash` as the
   effective `expectPrev` rather than requiring `GENESIS_HASH` — the
   existing `expectPrev` parameter, not new verification logic. `naro
   verify`'s output states plainly that the journal was pruned, through
   which sequence, when, and under what policy citation, distinguishing
   "verified, with a disclosed prune" from "verified, complete."

## Alternatives considered

- **Let operators delete rows directly; document it as their
  responsibility.** Rejected: this is the status quo, and it is exactly
  what produces a journal indistinguishable from tampering — the
  Article 12 gap analysis exists because this alternative is not
  sufficient for a regulated buyer who needs to show an auditor *why*
  events are missing, not just that some are.
- **Re-genesis: start a new chain at the anchor as if it were event #1,
  no `journal.retention.pruned` marker at all.** Rejected: this makes
  the fact that pruning occurred invisible — `naro verify` on the
  resulting journal would report a clean, complete chain, which is a
  false claim. The marker event exists specifically so pruning is
  disclosed, not hidden.
- **Prune at the storage layer only (a raw SQL job), with no kernel event
  or CLI command.** Rejected for the same reason as the first
  alternative, plus: every store (SQLite, Postgres, and any future one)
  would reinvent its own undocumented pruning behavior instead of one
  shared, attested operation.
- **Require sealing (a `sealKey`) as a precondition for pruning at
  all.** Considered and left optional rather than required: sealing
  strengthens the attestation (proves who pruned) but an unsealed
  deployment still benefits from the disclosure itself (proves *that* and
  *when* pruning happened, under what stated policy) even without a
  signature backing it — consistent with sealing being opt-in everywhere
  else in the journal.

## Consequences

- Closes the retention gap named in the Article 12 mapping without
  inventing new cryptography — reuses `expectPrev` and the existing
  Ed25519 seal primitives for a new operational purpose.
- Pruning is restricted to terminal runs, which means an operator cannot
  use this to satisfy a retention *floor* mid-run (deleting an active
  run's early history) — that restriction is deliberate: a live run's
  journal is its only path to `wake(runId)`.
- `EventStore` implementations that don't implement the optional
  `prune()` capability simply can't be pruned via `naro prune` — a bare
  `InMemoryEventStore`/test double needs no changes, matching the
  optional-capability pattern the rest of the kernel already uses.
- This still does not enforce a retention *floor* (nothing stops an
  operator from pruning earlier than a sectoral minimum requires) — that
  remains, as [docs/compliance/eu-ai-act-article-12.md](../compliance/eu-ai-act-article-12.md)
  already states, a deployment-operational control (who has permission to
  run `naro prune`), not something a process can enforce against an
  operator who already has database access to it.
- `naro verify --json`'s output schema gains a `prune` field when present
  — a consumer (an auditor's own tooling, or `@naro/client`) that doesn't
  know about it can ignore it; one that does gets a precise disclosure
  instead of an opaque "chain starts mid-sequence."
