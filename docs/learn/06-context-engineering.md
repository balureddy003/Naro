# 06 — Context Engineering

## The one-sentence version

Context engineering is deciding *what the model sees* — because the context
window is finite, attention is imperfect, and every token costs money and
noise.

## Analogy

A chef's mise en place: you can only fit so many ingredients on the counter.
The art is choosing which ones, in which order — not piling up the pantry.

## The pipeline (spec §8)

```mermaid
flowchart LR
    D["Discover sources"] --> R["Retrieve candidates"]
    R --> RK["Rank by relevance"] --> S["Select top-k"]
    S --> A["Assemble prompt segment"] --> C["Compress (summarize/truncate)"]
    C --> B["Budget: fit tokens"] --> P["Provide to model"]
```

Key ideas:

- **Budget is real**: context window minus output reserve minus system
  prompt = what you may spend. Track it like money.
- **Order matters**: instructions first, most important evidence early or
  late (models weight the edges — "lost in the middle" is measured, not
  folklore).
- **Provenance travels with content**: every item knows its source —
  required for audit *and* for trusting different sources differently.

## In Naro

- `ContextItem { id, source, content, score? }` — provenance built in.
- `ContextProvider.retrieve(query)` is the seam; the full engine
  (rank/select/assemble/compress/budget) is Phase 6 behind this interface.
- The runner mediates: reasoner says `need-context`, runtime calls the
  provider, emits `context.retrieved`. Context is *requested*, never
  hard-coded into prompts.

## Failure modes
- **Context rot**: performance degrades as prompts grow long even below the
  limit → budget + compress, don't just fill.
- **Self-referential loops**: agent retrieves its own past errors → provenance
  and source filters.
- **Budget blowout**: retrieval returns more than fits → selection stage must
  enforce hard caps.

## Security
- Untrusted sources are marked; retrieved text never gains instruction
  authority (see pages 04, 11).

## Scale
- Cache retrieval results; embed once, reuse.
- Token budgets are also cost budgets — `Usage` flows through model calls so
  you can meter per-agent spend.

## Swap
Retrieval tech (vector DB, BM25, SQL, graph) changes behind `ContextProvider`.
The runtime never learns what a vector is.
