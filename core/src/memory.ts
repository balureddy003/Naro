import type { TrustLevel } from './observation.ts';

/**
 * Memory, viewed from the reasoning loop.
 *
 * The full tiered store (working/session/episodic/semantic/procedural)
 * lives in @naro/memory. Core only declares the *read seam* a reasoner
 * may consult — keeping the kernel free of storage details while letting
 * decisions be informed by recall.
 */
export interface MemoryHit {
  readonly id: string;
  readonly key: string;
  readonly content: unknown;
  readonly score?: number;
  /**
   * Provenance the writer stamped on the entry (ADR 0019) — lets prompt
   * assembly grade recalled memory the same way live observations are
   * graded (`UNTRUSTED` framing for 'external'). Absent means unknown
   * trust, not system-trusted.
   */
  readonly trust?: TrustLevel;
}

/** Minimal read interface; @naro/memory's MemoryStore extends it. */
export interface MemoryReader {
  search(query: string, limit?: number): Promise<readonly MemoryHit[]>;
}
