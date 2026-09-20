# 07 — Memory

## The one-sentence version

Context is what the model sees *now*; memory is what the agent retains
*across time* — and different kinds of remembering need different stores.

## Analogy

Human memory: working memory (what you're holding in your head), episodic
(what happened yesterday), semantic (facts you know), procedural (skills you
have). No single mechanism serves all four — and no single database does
either.

## The tiers

| Tier | Holds | Lifetime | Typical store |
|---|---|---|---|
| Working | current turn's scratchpad | one call | the prompt itself |
| Session | this run's events/observations | one session | in-memory / Redis |
| Episodic | past episodes ("last deploy failed") | long | DB + vector recall |
| Semantic | facts, knowledge | long | vector/graph DB |
| Procedural | skills, strategies, prompts that worked | long | registry/fine-tune |
| Long-term log | everything, for audit | forever | append-only store |

## In Naro

- Today's memory IS the event log + observation list + context items —
  session memory is already real: `ctx.observations` is the agent's
  evidence trail, and checkpoints persist it.
- `@naro/memory` implements the tiered `MemoryStore` port
  (`write`/`read`/`search`/`searchTier`/`forget`) with in-memory and file
  stores; DB/vector adapters follow the same contract.
- `memory.written` events already exist so the future subsystem is
  observable from day one.

## Failure modes
- **Memory poisoning**: a bad episode teaches the wrong lesson → write
  memories with provenance and confidence; let verification, not the model,
  decide what becomes "fact".
- **Unbounded growth**: recall quality decays as stores fill → TTLs,
  summarization, tiering.
- **Cross-tenant leakage**: memories must carry tenant/agent scope.

## Security
- Memory is a persistence channel for injection: a poisoned memory outlives
  the session that created it. Validate on write, fence on read.
- PII in memory needs the same controls as PII in databases.

## Scale
- Tier by access speed: hot session state in-process, cold recall in a
  vector DB. Expensive stores only for what needs semantic recall.

## Swap
`MemoryStore` is the seam — `InMemory` for dev, Postgres for structured,
Qdrant for semantic. Agent code never changes.
