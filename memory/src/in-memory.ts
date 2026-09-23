import type { MemoryHit } from '@naro/core';
import {
  createMemoryEntry,
  textScore,
  type MemoryEntry,
  type MemoryInput,
  type MemoryStore,
  type MemoryTier,
} from './store.ts';

/**
 * Process-local memory — the honest default. Lexical (substring) recall;
 * semantic recall needs an embedding-aware adapter, which this is not.
 */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly entries = new Map<string, MemoryEntry>();

  write(input: MemoryInput): Promise<MemoryEntry> {
    const entry = createMemoryEntry(input);
    this.entries.set(entry.key, entry);
    return Promise.resolve(entry);
  }

  read(key: string): Promise<MemoryEntry | undefined> {
    return Promise.resolve(this.entries.get(key));
  }

  search(query: string, limit = 5): Promise<readonly MemoryHit[]> {
    return Promise.resolve(this.rank([...this.entries.values()], query, limit));
  }

  searchTier(tier: MemoryTier, query: string, limit = 5): Promise<readonly MemoryHit[]> {
    const inTier = [...this.entries.values()].filter((e) => e.tier === tier);
    return Promise.resolve(this.rank(inTier, query, limit));
  }

  forget(key: string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(key));
  }

  private rank(entries: MemoryEntry[], query: string, limit: number): MemoryHit[] {
    return entries
      .map((e) => ({ id: e.id, key: e.key, content: e.content, score: textScore(query, e), ...(e.trust !== undefined && { trust: e.trust }) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
