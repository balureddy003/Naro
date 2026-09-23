import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createGoal, generateSealKeypair, GENESIS_HASH, hashEvent, verifyChain,
  type EventDataMap, type EventType, type NaroEvent,
} from '@naro/core';
import { SqliteEventStore } from './sqlite-event-store.ts';

/** Build a real hash-chained journal — same fields EventBus produces. */
function journal(runId = 'r1'): NaroEvent[] {
  const goal = createGoal({ description: 'g' });
  const defs: [EventType, EventDataMap[EventType]][] = [
    ['agent.created', { name: 'a1' }],
    ['goal.started', { goal }],
    ['reasoning.started', { iteration: 0 }],
    ['action.requested', { action: {
      id: 'act1', agentId: 'a1', goalId: goal.id, capability: 'env.write',
      target: 'env://local/k', input: {}, state: 'requested', at: 0, idempotencyKey: 'k',
    } as never }],
    ['agent.completed', { result: 'done' }],
  ];
  const evs: NaroEvent[] = [];
  let prev = GENESIS_HASH;
  defs.forEach(([type, data], i) => {
    const unsigned = {
      id: `e${i + 1}-${runId}`, type, seq: i + 1, at: 1_000 + i,
      agentId: 'a1', goalId: goal.id, runId, prev, data,
    };
    const e = { ...unsigned, hash: hashEvent(unsigned) } as NaroEvent;
    evs.push(e);
    prev = e.hash!;
  });
  return evs;
}

async function storeWith(events: NaroEvent[]): Promise<{ store: SqliteEventStore; path: string }> {
  const path = join(await mkdtemp(join(tmpdir(), 'naro-prune-')), 'ev.db');
  const store = new SqliteEventStore(path);
  await store.export(events);
  await store.flush();
  return { store, path };
}

test('prune: writes a disclosure marker and the chain still verifies — disclosed, not clean', async () => {
  const { store } = await storeWith(journal());
  const res = await store.prune('r1', 3, { policy: 'GDPR Art. 5(1)(e)' });
  assert.equal(res.pruned, 3);

  const remaining = store.history({ runId: 'r1' });
  assert.equal(remaining.length, 3); // marker + events 4,5
  assert.equal(remaining[0]!.type, 'journal.retention.pruned');
  assert.equal((remaining[0]!.data as { prunedThroughSeq: number }).prunedThroughSeq, 3);

  const verdict = verifyChain(remaining);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.pruned?.throughSeq, 3);
  assert.equal(verdict.pruned?.anchorHash, res.anchorHash);
  assert.equal(verdict.pruned?.policy, 'GDPR Art. 5(1)(e)');
  store.close();
});

test('prune: attested marker verifies its Ed25519 signature; a forged one fails', async () => {
  const kp = generateSealKeypair();
  const { store } = await storeWith(journal());
  await store.prune('r1', 2, { policy: 'retention-30d', sealKey: kp.privateKeyPem });
  const verdict = verifyChain(store.history({ runId: 'r1' }));
  assert.equal(verdict.ok, true);
  assert.equal(verdict.pruned?.attested?.ok, true);
  assert.equal(verdict.pruned?.attested?.publicKey, kp.publicKeyPem);

  // Forgery: flip the signature — attestation must fail loudly.
  const forged = store.history({ runId: 'r1' }).map((e, i) => (i === 0
    ? { ...e, data: { ...(e.data as object), signature: Buffer.from('forged').toString('base64') } }
    : e)) as NaroEvent[];
  assert.equal(verifyChain(forged).ok, false);
  store.close();
});

test('prune: refuses a non-terminal run and a cutoff that erases the terminal event', async () => {
  const live = journal('live').slice(0, 3); // no terminal event
  const { store } = await storeWith(live);
  await assert.rejects(() => store.prune('live', 1), /not terminal/);
  store.close();

  const { store: s2 } = await storeWith(journal('r1'));
  await assert.rejects(() => s2.prune('r1', 5), /terminal event/);
  await assert.rejects(() => s2.prune('ghost', 1), /unknown run/);
  s2.close();
});

test('prune: without the marker a deleted-prefix journal reports BROKEN — the marker is the disclosure', async () => {
  const { store } = await storeWith(journal());
  await store.prune('r1', 3);
  // Simulate undeclared deletion: drop the marker, verify the survivors alone.
  const survivors = store.history({ runId: 'r1' }).filter((e) => e.type !== 'journal.retention.pruned');
  const verdict = verifyChain(survivors);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason ?? '', /broken link/);
  store.close();
});
