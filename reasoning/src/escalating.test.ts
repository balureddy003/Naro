import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAction, createGoal, createObservation,
  type ReasoningContext,
} from '@naro/core';
import { MockModel, textResponse } from '@naro/model';
import { ReActReasoner } from './react.ts';
import { EscalatingReasoner } from './escalating.ts';

function mkCtx(partial: Partial<ReasoningContext> = {}): ReasoningContext {
  return {
    agentId: 'a1',
    goal: createGoal({ description: 'g', successCriteria: [] }),
    state: 'REASONING',
    tasks: [],
    observations: [],
    actions: [],
    context: [],
    iteration: 0,
    ...partial,
  };
}

/** The runtime's evidence for a failed verification — see runner.ts. */
function failedVerification(reason = 'verifier says wrong'): ReturnType<typeof createObservation> {
  return createObservation({
    actionId: createAction('a1', { capability: 'tool.invoke', target: 'tool://x' }).id,
    source: 'verifier', kind: 'verification', success: false, error: reason,
  });
}

function tier(tag: string): ReActReasoner {
  return new ReActReasoner(new MockModel({ id: `mock-${tag}`, respond: () => textResponse(`answer from ${tag}`) }));
}

test('escalating: cheapest tier answers while there are no failures', async () => {
  const r = new EscalatingReasoner([tier('cheap'), tier('strong')]);
  const d = await r.decide(mkCtx());
  assert.equal(d.kind, 'complete');
  if (d.kind === 'complete') assert.match(String(d.result), /answer from cheap/);
  assert.equal(r.currentTier, 0);
});

test('escalating: a failed verification escalates the next decide()', async () => {
  const r = new EscalatingReasoner([tier('cheap'), tier('strong')]);
  await r.decide(mkCtx());
  const d = await r.decide(mkCtx({ observations: [failedVerification()] }));
  if (d.kind === 'complete') assert.match(String(d.result), /answer from strong/);
  assert.equal(r.currentTier, 1);
});

test('escalating: threshold of N failures before moving a tier', async () => {
  const r = new EscalatingReasoner([tier('a'), tier('b')], { escalateAfterFailures: 2 });
  const d1 = await r.decide(mkCtx({ observations: [failedVerification()] }));
  if (d1.kind === 'complete') assert.match(String(d1.result), /answer from a/);
  const d2 = await r.decide(mkCtx({ observations: [failedVerification(), failedVerification()] }));
  if (d2.kind === 'complete') assert.match(String(d2.result), /answer from b/);
});

test('escalating: never de-escalates and clamps at the strongest tier', async () => {
  const r = new EscalatingReasoner([tier('a'), tier('b')]);
  // Two failures would project past the last tier — clamp, don't overflow.
  const d = await r.decide(mkCtx({ observations: [failedVerification(), failedVerification(), failedVerification()] }));
  if (d.kind === 'complete') assert.match(String(d.result), /answer from b/);
  assert.equal(r.currentTier, 1);
  // And once escalated, a later decide() with no failures stays escalated.
  const d2 = await r.decide(mkCtx());
  if (d2.kind === 'complete') assert.match(String(d2.result), /answer from b/);
});

test('escalating: tier survives checkpoint capture/restore', async () => {
  const r = new EscalatingReasoner([tier('a'), tier('b')]);
  await r.decide(mkCtx({ observations: [failedVerification()] }));
  const state = r.captureState();

  const revived = new EscalatingReasoner([tier('a'), tier('b')]);
  revived.restoreState(state);
  assert.equal(revived.currentTier, 1);
  const d = await revived.decide(mkCtx());
  if (d.kind === 'complete') assert.match(String(d.result), /answer from b/);
});

test('escalating: decisions pass through unchanged — it never claims completion itself', async () => {
  const r = new EscalatingReasoner([tier('a'), tier('b')]);
  const d = await r.decide(mkCtx());
  // Whatever the child decided is returned verbatim — the runtime's own
  // VERIFYING transition gates the claim, exactly as for any reasoner.
  assert.equal(d.kind, 'complete');
});

test('escalating: requires at least two tiers', () => {
  assert.throws(() => new EscalatingReasoner([tier('only')]), /at least two tiers/);
});

test('escalating: strategy names the composed tiers', () => {
  const r = new EscalatingReasoner([tier('a'), tier('b')]);
  assert.equal(r.strategy, 'escalating(react→react)');
});
