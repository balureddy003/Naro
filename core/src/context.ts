/**
 * A ContextItem is one retrieved piece of information — a document chunk,
 * a file, an API result, a memory. Context items are *evidence with
 * provenance*: `source` always records where they came from.
 */
export interface ContextItem {
  readonly id: string;
  readonly source: string;
  readonly content: unknown;
  /** Optional relevance score assigned by the retriever/ranker. */
  readonly score?: number;
}

/**
 * The Phase-6 seam for the full Context Engine (retrieve → rank →
 * assemble → compress → budget). Today the runtime calls this when a
 * reasoner returns a 'need-context' decision; later phases plug in
 * real retrieval pipelines without touching the runner.
 */
export interface ContextProvider {
  retrieve(query: string): Promise<readonly ContextItem[]> | readonly ContextItem[];
}
