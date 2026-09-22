---
"@naro/adapter-gemini": minor
"@naro/model": minor
"@naro/memory": minor
"@naro/context": minor
---

Wire the declared `embeddings` capability to something that actually uses it.

- `@naro/adapter-gemini`: `GeminiModel.embed()` via `batchEmbedContents`.
- `@naro/model`: `MockModel` is `embeddings`-capable by default (a
  deterministic hashed bag-of-words, or an injected `embed` function) so
  embedding-dependent code can be tested offline.
- `@naro/memory`: `FileMemoryStore` and `SqliteMemoryStore` implement the
  new optional `EmbeddingIndex` port (`searchByEmbedding`), scoring
  persisted entries by cosine similarity against a caller-supplied query
  vector. `MemoryStore` itself is unchanged.
- `@naro/context`: a new `EmbeddingSource` — the semantic counterpart to
  `KeywordSource` — embeds a document set once and scores retrieval by
  cosine similarity against the embedded query. `@naro/context` now
  depends on `@naro/model`.

Previously `Model.embed()` was declared in the interface and implemented
only by the OpenAI-compatible adapter, with no store or context source able
to use it — the `embedding` column on `MemoryEntry` was schema-ready but
nothing populated a matching query. This closes that gap with in-process
cosine similarity; a dedicated vector database is still a separate adapter
behind the same `EmbeddingIndex`/`ContextSource` contracts.
