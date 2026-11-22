# Context, Memory, and RAG

## Decision guide

| Need | Preferred mechanism | When to avoid |
|------|---------------------|---------------|
| Facts that change often or are large | RAG (retrieval) | Stuffing everything into the prompt |
| Short-term working state for this run | Context window + compaction | Unbounded history |
| Durable user or agent preferences | Memory store (tiered) | Re-retrieving the same preference every turn |
| Exact prior actions and evidence | Journal (not memory) | Treating the journal as a vector store |

## Trade-offs

- RAG adds latency and retrieval-quality risk; it reduces hallucination on known facts.
- Memory improves continuity but can inject stale or poisoned information if not scoped.
- Context engineering (ranking, compression, budgets) is usually cheaper than larger models.

## Naro realization

- `@naro/context` — sources → rank → select → compress → budget.
- `@naro/memory` — tiered stores (in-memory, JSONL, SQLite FTS).
- Journal remains the source of truth for what actually happened; memory and RAG are advisory.

## Anti-patterns

- Using the model’s context window as the only memory.
- RAG without provenance or citation requirements.
- Memory that can override a policy denial.

See also: [Context engineering](../../learn/06-context-engineering.md), [Memory](../../learn/07-memory.md), [RAG](../../learn/04-rag.md).
