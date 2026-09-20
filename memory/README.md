# @naro/memory

Provider-independent memory for information retained across decisions or runs.
Context is what the reasoner sees now; memory is what it may recall later.

## Tiers

```text
working · session · episodic · semantic · procedural · longterm
```

The tiers describe purpose and lifetime. They do not force one storage
technology.

## Contract

```ts
interface MemoryStore extends MemoryReader {
  write(input: MemoryInput): Promise<MemoryEntry>;
  read(key: string): Promise<MemoryEntry | undefined>;
  search(query: string, limit?: number): Promise<readonly MemoryHit[]>;
  searchTier(tier: MemoryTier, query: string, limit?: number): Promise<readonly MemoryHit[]>;
  forget(key: string): Promise<boolean>;
}
```

Reasoners receive the smaller `MemoryReader` through `ctx.memory`. The
application or strategy decides what is safe and useful to write.

## Included stores

| Store | Persistence | Recall | Use |
|---|---|---|---|
| `InMemoryMemoryStore` | process only | lexical | tests and local development |
| `FileMemoryStore` | JSONL files | lexical | zero-infrastructure persistence |
| `SqliteMemoryStore` | transactional SQLite | FTS5/BM25 with lexical fallback | durable single-host agents |

`SqliteMemoryStore` supports tier-scoped search and durable deletion. Its
embedding column preserves a future vector-recall seam; the included search is
FTS5 rather than vector similarity.

## Example

```ts
const memory = new SqliteMemoryStore('.naro/memory.db');
await memory.write({
  key: 'deploy:last-failure',
  tier: 'episodic',
  content: 'migration timed out',
  agentId,
  source: 'verification',
});

const hits = await memory.searchTier('episodic', 'migration failure', 5);
```

## Trust rules

- Scope entries by agent or tenant before results reach the model.
- Preserve source and time.
- Do not promote model claims to facts without verification.
- Treat recalled content as untrusted prompt data.
- Define retention and deletion for PII and secrets.

SQLite is a durable single-host implementation. Multi-host deployments need a
shared store behind the same `MemoryStore` contract.
