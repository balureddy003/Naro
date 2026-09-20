import type { ContextItem } from '@naro/core';

/** Re-scores and orders candidates after retrieval. */
export interface Ranker {
  rank(items: readonly ContextItem[], query: string): ContextItem[];
}

/** Default: honor the source's own score; unscored items sink to 0. */
export class ScoreRanker implements Ranker {
  rank(items: readonly ContextItem[]): ContextItem[] {
    return [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }
}

/**
 * Hard limits on what reaches the model. `maxChars` is the honest proxy
 * for tokens (~4 chars/token) — a token-aware adapter can be exact.
 */
export interface ContextBudget {
  readonly maxItems?: number;
  readonly maxChars?: number;
}

/** Trim an item's content to fit a character cap (compression, honest cut). */
export function truncateItem(item: ContextItem, maxChars: number): ContextItem {
  if (typeof item.content !== 'string' || item.content.length <= maxChars) return item;
  const marker = '…[truncated]';
  if (maxChars <= marker.length) return { ...item, content: item.content.slice(0, maxChars) };
  return { ...item, content: item.content.slice(0, maxChars - marker.length) + marker };
}
