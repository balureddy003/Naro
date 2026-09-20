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
| `Ranker` / `ScoreRanker` | re-score merged candidates; honor source scores |
| `ContextBudget` | `maxItems` + `maxChars` hard caps — context rot and cost control |

## The rules

- **Provenance**: every item carries `source`. Required for audit *and*
  for injection defense (retrieved text is untrusted).
- **Budget is enforced**: what doesn't fit doesn't reach the model.
- **Technology-free**: the engine orchestrates; sources own the how.
  A Qdrant source and a SQL source differ only inside `retrieve()`.
