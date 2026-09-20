# @naro/memory

Tiered, provider-independent memory. Context is what the model sees *now*;
memory is what the agent retains *across time*.

## Tiers

`working` · `session` · `episodic` · `semantic` · `procedural` · `longterm`

Different lifetimes, different access patterns — that's why they're
separate, and why "just use a vector DB" is wrong.

## Contracts

```ts
interface MemoryStore extends MemoryReader {   // MemoryReader lives in core
  write(input: MemoryInput): Promise<MemoryEntry>;
  read(key: string): Promise<MemoryEntry | undefined>;
  search(query: string, limit?): Promise<MemoryHit[]>;       // recall
  searchTier(tier, query, limit?): Promise<MemoryHit[]>;     // scoped recall
  forget(key: string): Promise<boolean>;
}
```

## Included stores

- `InMemoryMemoryStore` — process-local, lexical recall. Dev/tests.
- `FileMemoryStore` — JSONL append per tier; survives restarts, zero infra.

Adapters for SQLite/Postgres/Redis/Qdrant implement the same interface.

## In the loop

Pass a store as `AgentDeps.memory` — reasoners see it as
`ctx.memory` (a `MemoryReader`). What gets written, and when, is a
strategy concern; the store itself never decides.
