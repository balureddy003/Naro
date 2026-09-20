import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Structural mirror of runtime's CheckpointStore — no dep, no cycle. */
export interface CheckpointLike {
  readonly id: string;
  readonly agentId: string;
  readonly at: number;
  readonly state: string;
  readonly data: unknown;
}
export interface CheckpointStoreLike {
  save(c: CheckpointLike): Promise<void>;
  latest(agentId: string): Promise<CheckpointLike | undefined>;
}

const ckpt = (agentId: string, state = 'REASONING', iteration = 1): CheckpointLike => ({
  id: `ck-${Math.random().toString(36).slice(2)}`, agentId, at: Date.now(), state,
  data: { iteration, tasks: [], observations: [], context: [] },
});

/** The contract every CheckpointStore must honor. Call from your package's tests. */
export function checkpointStoreContract(name: string, make: () => CheckpointStoreLike | Promise<CheckpointStoreLike>): void {
  test(`${name}: latest() is empty for an unknown agent`, async () => {
    const s = await make();
    assert.equal(await s.latest('nobody'), undefined);
  });

  test(`${name}: save → latest returns the checkpoint`, async () => {
    const s = await make();
    const c = ckpt('a1');
    await s.save(c);
    const got = await s.latest('a1');
    assert.equal(got?.id, c.id);
    assert.equal(got?.state, 'REASONING');
  });

  test(`${name}: latest returns the MOST RECENT save`, async () => {
    const s = await make();
    await s.save(ckpt('a1', 'REASONING', 1));
    const newest = ckpt('a1', 'REASONING', 9);
    await s.save(newest);
    const got = await s.latest('a1');
    assert.equal((got?.data as { iteration: number }).iteration, 9);
  });

  test(`${name}: agents are isolated — no cross-talk`, async () => {
    const s = await make();
    await s.save(ckpt('a1'));
    assert.equal(await s.latest('a2'), undefined);
    assert.ok(await s.latest('a1'));
  });
}
