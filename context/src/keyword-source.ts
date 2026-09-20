import { newId, type ContextItem } from '@naro/core';
import type { ContextQuery, ContextSource } from './source.ts';

export interface Document {
  readonly id?: string;
  readonly text: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function overlap(query: string, text: string): number {
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  return terms.filter((t) => lower.includes(t)).length / terms.length;
}

/**
 * Keyword/BM25-lite retrieval over an in-memory document set — the
 * reference ContextSource. Proves the pipeline without a vector DB;
 * Qdrant/OpenSearch/SQL sources implement the same one-method contract.
 */
export class KeywordSource implements ContextSource {
  readonly id: string;
  private readonly docs: Document[];

  constructor(id: string, docs: readonly Document[]) {
    this.id = id;
    this.docs = [...docs];
  }

  retrieve(query: ContextQuery): ContextItem[] {
    return this.docs
      .map((doc) => ({
        id: doc.id ?? newId('ctx'),
        source: this.id,
        content: doc.text,
        score: overlap(query.text, doc.text),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit ?? 10);
  }
}
