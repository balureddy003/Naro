import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Structural mirror of memory's MemoryStore — no dep, no cycle. */
export interface MemoryEntryLike {
  readonly id: string;
  readonly key: string;
  readonly content: unknown;
  readonly tier: string;
}
export interface MemoryStoreLike {
  write(input: { key: string; content: unknown; tier?: string }): Promise<MemoryEntryLike>;
  read(key: string): Promise<MemoryEntryLike | undefined>;
  search(query: string, limit?: number): Promise<readonly { key: string }[]>;
  searchTier(tier: string, query: string, limit?: number): Promise<readonly { key: string }[]>;
  forget(key: string): Promise<boolean>;
}

/**
 * The contract every MemoryStore must honor: write→read fidelity,
 * recall that finds what was stored, tier confinement, and a forget
 * that actually forgets. Call from your package's tests.
 */
export function memoryStoreContract(name: string, make: () => MemoryStoreLike | Promise<MemoryStoreLike>): void {
  test(`${name}: write → read round-trips`, async () => {
    const s = await make();
    await s.write({ key: 'k1', content: { v: 1 }, tier: 'semantic' });
    const e = await s.read('k1');
    assert.equal(e?.key, 'k1');
    assert.deepEqual(e?.content, { v: 1 });
  });

  test(`${name}: read of a missing key is undefined, not an error`, async () => {
    assert.equal(await (await make()).read('nope'), undefined);
  });

  test(`${name}: search finds stored content`, async () => {
    const s = await make();
    await s.write({ key: 'fact', content: 'the sky is blue', tier: 'semantic' });
    const hits = await s.search('sky');
    assert.ok(hits.some((h) => h.key === 'fact'));
  });

  test(`${name}: searchTier stays inside its tier`, async () => {
    const s = await make();
    await s.write({ key: 'w', content: 'shared term', tier: 'working' });
    await s.write({ key: 's', content: 'shared term', tier: 'semantic' });
    const hits = await s.searchTier('semantic', 'term');
    assert.ok(hits.every((h) => h.key === 's'));
  });

  test(`${name}: forget removes the entry`, async () => {
    const s = await make();
    await s.write({ key: 'doomed', content: 'x', tier: 'session' });
    assert.equal(await s.forget('doomed'), true);
    assert.equal(await s.read('doomed'), undefined);
  });
}
