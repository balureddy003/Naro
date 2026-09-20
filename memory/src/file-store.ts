import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
 * File-backed memory — JSONL append per tier under `dir`. Survives
 * restarts, zero infrastructure. The reference for "persistence without
 * a database"; swap in SQLite/Redis/vector stores via the same interface.
 */
export class FileMemoryStore implements MemoryStore {
  private readonly dir: string;
  private cache?: Map<string, MemoryEntry>;

  constructor(dir: string) {
    this.dir = dir;
  }

  private fileFor(tier: MemoryTier): string {
    return join(this.dir, `${tier}.jsonl`);
  }

  private async load(): Promise<Map<string, MemoryEntry>> {
    if (this.cache) return this.cache;
    const entries = new Map<string, MemoryEntry>();
    const tiers: MemoryTier[] = ['working', 'session', 'episodic', 'semantic', 'procedural', 'longterm'];
    for (const tier of tiers) {
      try {
        const text = await readFile(this.fileFor(tier), 'utf8');
        for (const line of text.split('\n').filter(Boolean)) {
          const e = JSON.parse(line) as MemoryEntry;
          entries.set(e.key, e);
        }
      } catch { /* file may not exist yet */ }
    }
    this.cache = entries;
    return entries;
  }

  async write(input: MemoryInput): Promise<MemoryEntry> {
    const entry = createMemoryEntry(input);
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.fileFor(entry.tier), JSON.stringify(entry) + '\n');
    (await this.load()).set(entry.key, entry);
    return entry;
  }

  async read(key: string): Promise<MemoryEntry | undefined> {
    return (await this.load()).get(key);
  }

  async search(query: string, limit = 5): Promise<readonly MemoryHit[]> {
    return this.rank([...(await this.load()).values()], query, limit);
  }

  async searchTier(tier: MemoryTier, query: string, limit = 5): Promise<readonly MemoryHit[]> {
    const inTier = [...(await this.load()).values()].filter((e) => e.tier === tier);
    return this.rank(inTier, query, limit);
  }

  async forget(key: string): Promise<boolean> {
    // Deletion must be durable — a 'forgotten' entry that reloads after
    // restart is a correctness and privacy bug. Compact: remove from the
    // cache, then rewrite whichever tier file held it.
    const cache = await this.load();
    const entry = cache.get(key);
    if (!entry) return false;
    cache.delete(key);
    const remaining = [...cache.values()].filter((e) => e.tier === entry.tier);
    await writeFile(this.fileFor(entry.tier), remaining.map((e) => JSON.stringify(e)).join('\n') + (remaining.length ? '\n' : ''));
    return true;
  }

  private rank(entries: MemoryEntry[], query: string, limit: number): MemoryHit[] {
    return entries
      .map((e) => ({ id: e.id, key: e.key, content: e.content, score: textScore(query, e) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
