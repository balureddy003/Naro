import { newId, type MemoryHit, type MemoryReader, type TrustLevel } from '@naro/core';

/**
 * The six memory tiers — modeled on human memory, separated because they
 * differ in lifetime, access pattern, and what they're *for*. No single
 * database serves all six well; tiering is the point.
 */
export type MemoryTier =
  | 'working'     // the current turn's scratchpad — effectively the prompt
  | 'session'     // this run's events and observations
  | 'episodic'    // past episodes: "last deploy failed at step 3"
  | 'semantic'    // durable facts and knowledge
  | 'procedural'  // learned skills and strategies that worked
  | 'longterm';   // append-only audit of everything

export interface MemoryEntry {
  readonly id: string;
  readonly key: string;
  readonly content: unknown;
  readonly tier: MemoryTier;
  readonly tags: readonly string[];
  /** Embedding vector if the store/entry carries one (semantic recall). */
  readonly embedding?: readonly number[];
  readonly at: number;
  readonly agentId?: string;
  /** Free-form source marker — memory should always know where it came from. */
  readonly source?: string;
  /**
   * Provenance of the content (ADR 0019) — same vocabulary as
   * `Observation.trust`. `undefined` means unknown-trust, NOT system —
   * an app that doesn't set it gets no false assurance either way.
   * Applications writing memories derived from external observations
   * should pass the observation's trust through explicitly.
   */
  readonly trust?: TrustLevel;
}

export interface MemoryInput {
  key: string;
  content: unknown;
  tier?: MemoryTier;          // default 'session'
  tags?: readonly string[];
  embedding?: readonly number[];
  agentId?: string;
  source?: string;
  /** Provenance of the content — see `MemoryEntry.trust` (ADR 0019). */
  trust?: TrustLevel;
}

export function createMemoryEntry(input: MemoryInput): MemoryEntry {
  return {
    id: newId('mem'),
    key: input.key,
    content: input.content,
    tier: input.tier ?? 'session',
    tags: input.tags ?? [],
    at: Date.now(),
    ...(input.embedding !== undefined && { embedding: input.embedding }),
    ...(input.agentId !== undefined && { agentId: input.agentId }),
    ...(input.source !== undefined && { source: input.source }),
    ...(input.trust !== undefined && { trust: input.trust }),
  };
}

/**
 * The memory port. Read-side is core's `MemoryReader` (reasoners can
 * search); write-side is the store. Implementations: in-memory here,
 * SQLite/Postgres/Redis/vector DBs as adapters.
 */
export interface MemoryStore extends MemoryReader {
  write(input: MemoryInput): Promise<MemoryEntry>;
  read(key: string): Promise<MemoryEntry | undefined>;
  /** Text/tag recall; embedding-aware stores may override scoring. */
  search(query: string, limit?: number): Promise<readonly MemoryHit[]>;
  /** Recall within one tier — "search only episodic memory". */
  searchTier(tier: MemoryTier, query: string, limit?: number): Promise<readonly MemoryHit[]>;
  forget(key: string): Promise<boolean>;
}

/** Naive scoring: term overlap between query and key/tags/content-text. */
export function textScore(query: string, entry: MemoryEntry): number {
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const hay = `${entry.key} ${entry.tags.join(' ')} ${
    typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content)
  }`.toLowerCase();
  const hits = terms.filter((t) => hay.includes(t)).length;
  return hits / terms.length;
}
