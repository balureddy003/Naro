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
}

/** Minimal read interface; @naro/memory's MemoryStore extends it. */
export interface MemoryReader {
  search(query: string, limit?: number): Promise<readonly MemoryHit[]>;
}
