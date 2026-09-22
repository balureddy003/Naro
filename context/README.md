# @naro/context

The Context Engine — "context as a service".

## Pipeline

```
sources (fan-out) → merge → rank → select (maxItems)
→ compress (truncate) → budget (maxChars) → ContextItem[]
```

| Export | Role |
|---|---|
| `ContextEngine` | implements core `ContextProvider` — plugs straight into `AgentDeps.context` |
| `ContextSource` | one-method port: `retrieve(query) → ContextItem[]` — files, SQL, vectors, APIs |
| `KeywordSource` | reference source: term-overlap over in-memory docs |
| `EmbeddingSource` | semantic source: cosine similarity over docs embedded via `Model.embed()` |
| `Ranker` / `ScoreRanker` | re-score merged candidates; honor source scores |
| `ContextBudget` | `maxItems` + `maxChars` hard caps — context rot and cost control |

## Semantic retrieval

`EmbeddingSource` requires a `Model` with the `embeddings` capability
(`@naro/adapter-openai`, `@naro/adapter-gemini`'s embedding model, or
`MockModel` for offline tests/examples — see `@naro/model`):

```ts
const source = await EmbeddingSource.create('docs', model, [
  { id: 'd1', text: 'the deploy pipeline fails when migrations run late' },
  { id: 'd2', text: 'deploy checklist: run migrations first, then restart' },
]);
const engine = new ContextEngine({ sources: [source] });
const items = await engine.retrieve('why did the deploy break?');
```

Documents are embedded once at construction (`create` is async because
embedding is); each `retrieve` embeds only the query. Scoring is an
O(docs) cosine-similarity scan in application code — the same honest
baseline as `@naro/memory`'s `searchByEmbedding`, not a production vector
index. Swap in a Qdrant/pgvector-backed `ContextSource` behind the same
one-method contract once a document set outgrows an in-process scan.

## The rules

- **Provenance**: every item carries `source`. Required for audit *and*
  for injection defense (retrieved text is untrusted).
- **Budget is enforced**: what doesn't fit doesn't reach the model.
- **Technology-free**: the engine orchestrates; sources own the how.
  A Qdrant source and a SQL source differ only inside `retrieve()`.
