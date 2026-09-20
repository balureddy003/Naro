import type { ContextItem } from '@naro/core';

export interface ContextQuery {
  readonly text: string;
  /** Max candidates the source should return (pre-ranking). */
  readonly limit?: number;
  readonly filters?: Readonly<Record<string, unknown>>;
}

/**
 * A source of context — files, repos, docs, databases, APIs, browser
 * state, memory, events, sensors. Each implementation knows one kind of
 * place; the engine doesn't care which.
 *
 * Contract: items must carry `source` provenance, and should carry a
 * `score` when the source has a natural relevance signal (BM25, vector
 * similarity). Unscored items get ranked by the engine's ranker.
 */
export interface ContextSource {
  readonly id: string;
  retrieve(query: ContextQuery): Promise<readonly ContextItem[]> | readonly ContextItem[];
}
