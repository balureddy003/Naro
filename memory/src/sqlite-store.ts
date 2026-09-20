import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MemoryHit } from '@naro/core';
import {
  createMemoryEntry, textScore,
  type MemoryEntry, type MemoryInput, type MemoryStore, type MemoryTier,
} from './store.ts';

interface Row {
  id: string; key: string; tier: string; content: string; tags: string;
  agent_id: string | null; source: string | null; at: number; embedding: string | null;
}

/**
 * Durable memory on node:sqlite — real persistence plus FTS5 full-text
 * recall (bm25 ranking) instead of naive substring scoring.
 *
 * The same MemoryStore port: swap FileMemoryStore → SqliteMemoryStore
 * and search gets faster, forget stays durable, nothing else changes.
 * Vector recall plugs in later via the entry's `embedding` column.
 */
export class SqliteMemoryStore implements MemoryStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        tier TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL,
        agent_id TEXT,
        source TEXT,
        at INTEGER NOT NULL,
        embedding TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts
        USING fts5(key, content, tags, content='entries', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
        INSERT INTO entries_fts(rowid, key, content, tags)
          VALUES (new.rowid, new.key, json_extract(new.content,'$'), new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, key, content, tags)
          VALUES ('delete', old.rowid, old.key, json_extract(old.content,'$'), old.tags);
      END;
    `);
  }

  write(input: MemoryInput): Promise<MemoryEntry> {
    const e = createMemoryEntry(input);
    this.db.prepare(
      'INSERT OR REPLACE INTO entries (id, key, tier, content, tags, agent_id, source, at, embedding) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(
      // Always JSON-encoded: '42' must read back as the string, not the
      // number — and the FTS trigger's json_extract needs valid JSON.
      e.id, e.key, e.tier, JSON.stringify(e.content), JSON.stringify(e.tags),
      e.agentId ?? null, e.source ?? null, e.at,
      e.embedding ? JSON.stringify(e.embedding) : null,
    );
    return Promise.resolve(e);
  }

  read(key: string): Promise<MemoryEntry | undefined> {
    const row = this.db.prepare('SELECT * FROM entries WHERE key = ?').get(key) as Row | undefined;
    return Promise.resolve(row && this.toEntry(row));
  }

  /** FTS5 bm25 recall; falls back to substring scoring if the query isn't FTS-safe. */
  search(query: string, limit = 5): Promise<readonly MemoryHit[]> {
    return this.searchTier_(query, limit);
  }

  searchTier(tier: MemoryTier, query: string, limit = 5): Promise<readonly MemoryHit[]> {
    return this.searchTier_(query, limit, tier);
  }

  private searchTier_(query: string, limit: number, tier?: MemoryTier): Promise<readonly MemoryHit[]> {
    const ftsQuery = query.trim().split(/\s+/).filter(Boolean)
      .map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
    if (!ftsQuery) return Promise.resolve([]);
    try {
      const rows = this.db.prepare(`
        SELECT e.*, bm25(entries_fts) AS rank FROM entries_fts
        JOIN entries e ON e.rowid = entries_fts.rowid
        WHERE entries_fts MATCH ? ${tier ? 'AND e.tier = ?' : ''}
        ORDER BY rank LIMIT ?
      `).all(...(tier ? [ftsQuery, tier, limit] : [ftsQuery, limit])) as unknown as (Row & { rank: number })[];
      return Promise.resolve(rows.map((r) => ({
        id: r.id, key: r.key, content: safeParse(r.content),
        score: 1 / (1 + Math.abs(r.rank)),
      })));
    } catch {
      // Query wasn't FTS-safe — degrade to substring scoring, not silence.
      const all = this.allRows(tier);
      const scored = all
        .map((e) => ({ id: e.id, key: e.key, content: e.content, score: textScore(query, e) }))
        .filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
      return Promise.resolve(scored);
    }
  }

  private allRows(tier?: MemoryTier): MemoryEntry[] {
    const rows = (tier
      ? this.db.prepare('SELECT * FROM entries WHERE tier = ?').all(tier)
      : this.db.prepare('SELECT * FROM entries').all()) as unknown as Row[];
    return rows.map((r) => this.toEntry(r));
  }

  private toEntry(r: Row): MemoryEntry {
    return {
      id: r.id, key: r.key, tier: r.tier as MemoryTier,
      content: safeParse(r.content), tags: JSON.parse(r.tags) as string[],
      at: r.at,
      ...(r.agent_id !== null && { agentId: r.agent_id }),
      ...(r.source !== null && { source: r.source }),
      ...(r.embedding !== null && { embedding: JSON.parse(r.embedding) as number[] }),
    };
  }

  /** Durable delete — removes the row AND its FTS index entry. */
  forget(key: string): Promise<boolean> {
    const r = this.db.prepare('DELETE FROM entries WHERE key = ?').run(key);
    return Promise.resolve(r.changes > 0);
  }

  close(): void { this.db.close(); }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
