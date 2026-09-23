import type { MemoryHit } from '@naro/core';
import type { MemoryTier } from './store.ts';

/**
 * Cosine similarity between two vectors. Compares only the overlapping
 * prefix rather than throwing on a length mismatch — a store may hold
 * entries embedded by different models across their lifetime, and a
 * mismatched pair should score low, not crash recall. Degenerate
 * (zero-magnitude) input scores 0, never NaN, so it sorts last instead of
 * poisoning the ranking.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Semantic recall by a pre-computed query vector. Optional and additive —
 * implemented by stores that persist `MemoryEntry.embedding`, without
 * changing the `MemoryStore` contract every store must satisfy. Embed the
 * query yourself (`Model.embed()`) before calling; the store never calls a
 * model on your behalf.
 */
export interface EmbeddingIndex {
  searchByEmbedding(
    embedding: readonly number[],
    limit?: number,
    tier?: MemoryTier,
  ): Promise<readonly MemoryHit[]>;
}
