# 0005 — The hash chain is computed in the event bus, with optional fields

Status: accepted
Date: 2026-09-20

## Context

Naro's journal is immutable by construction inside one process
(`structuredClone` on emit), but a JSONL file or a database row can be edited
after the fact. For the evidence record to mean anything, a reader must be
able to detect that the journal it holds is not the journal that was written.

Two questions: *where* to compute the chain, and *how* to introduce it without
invalidating every journal already on disk.

## Decision

`EventBus.emit()` stamps each event with `prev` (the hash of the preceding
event, `GENESIS_HASH` for the first) and `hash` (SHA-256 over a canonical
serialization of the event excluding `hash`). The head is checkpointed and
restored so a resumed run continues the chain. `verifyChain()` in
`@naro/core` recomputes and reports the first break.

Both fields are optional on `NaroEvent`. A journal without them is reported by
`verifyChain` as `ok: false, reason: 'journal is not hash-chained'` — legacy
journals remain loadable, and they never verify by accident.

Canonicalization sorts object keys recursively and drops `undefined`, so a
round trip through JSON or a database column does not change the hash.

## Alternatives considered

- **Chain at export time (in `EventExporter`).** Rejected: an event that was
  emitted but not exported would be unchained, and two exporters would produce
  two chains for one run. The bus is the source of truth; the chain belongs
  there.
- **Required fields.** Rejected: a breaking type change with no migration path
  for stored journals and third-party exporters.
- **Signing instead of hashing.** Deferred: a chain is tamper-*evident*, not
  tamper-*proof*. A writer with access to the whole file can rewrite the whole
  chain. Signing the head with a key the writer does not hold is the next step
  and is listed in the roadmap; it builds on this decision rather than
  replacing it.
- **Merkle tree over the run.** Rejected for now: linear chains match the
  append-only, sequential nature of a run and are verifiable in one pass.

## Consequences

- Event stores must persist `prev` and `hash`. `SqliteEventStore` and
  `PgEventStore` add columns with an in-place migration; `JsonlExporter`
  writes whole events and needed no change. The exporter contract test checks
  the round trip.
- `naro verify <file.jsonl>` exits non-zero on a broken or unchained journal.
- The guarantee matrix in `production-readiness.md` says exactly
  "tamper-evident, not tamper-proof".
- Hashing costs one SHA-256 over the serialized event per emit. Large
  observation payloads make that proportionally larger; profiles already
  bound output sizes for the model's sake, which bounds this too.
