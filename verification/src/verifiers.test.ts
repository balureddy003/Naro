import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal, createObservation, type VerifyInput } from '@naro/core';
import { MockModel } from '@naro/model';
import { allOf, anyOf, CommandVerifier, LlmJudgeVerifier, PredicateVerifier, SchemaVerifier } from './index.ts';

const goal = createGoal({ description: 'ship it' });

test('SchemaVerifier validates the result', async () => {
  const v = new SchemaVerifier({ type: 'object', properties: { n: { type: 'number' } }, required: ['n'] });
  assert.equal((await v.verify({ goal, result: { n: 1 } })).ok, true);
  const bad = await v.verify({ goal, result: { n: 'x' } });
  assert.equal(bad.ok, false);
  assert.match(bad.reason ?? '', /\$.n/);
});

test('SchemaVerifier can target observation output', async () => {
  const v = new SchemaVerifier({ type: 'number' }, 'observation');
  const obs = createObservation({ actionId: 'x', source: 'tool://t', kind: 'tool-result', success: true, output: 42 });
  assert.equal((await v.verify({ goal, observation: obs })).ok, true);
  assert.equal((await v.verify({ goal, result: 42 })).ok, false); // wrong target
});

test('PredicateVerifier wraps domain checks', async () => {
  const v = new PredicateVerifier('big-enough', (i: VerifyInput) =>
    typeof i.result === 'number' && i.result > 10 ? true : { ok: false, reason: 'too small' });
  assert.equal((await v.verify({ goal, result: 42 })).ok, true);
  assert.equal((await v.verify({ goal, result: 2 })).reason, 'too small');
});

test('CommandVerifier runs real commands', async () => {
  assert.equal((await new CommandVerifier('true').verify()).ok, true);
  const fail = await new CommandVerifier('echo oops >&2; exit 3').verify();
  assert.equal(fail.ok, false);
  assert.match(fail.reason ?? '', /exit 3/);
});

test('allOf requires every verifier; anyOf accepts the first pass', async () => {
  const pass = new PredicateVerifier('p', () => true);
  const fail = new PredicateVerifier('f', () => ({ ok: false, reason: 'nope' }));
  assert.equal((await allOf('all', pass, fail).verify({ goal })).ok, false);
  assert.equal((await anyOf('any', fail, pass).verify({ goal })).ok, true);
});

test('LlmJudgeVerifier scores against the rubric', async () => {
  const model = new MockModel({ responses: [{ message: { role: 'assistant', content: '0.9' }, finishReason: 'stop' }] });
  const v = new LlmJudgeVerifier(model, 'is it correct?', 0.7);
  const r = await v.verify({ goal, result: 'answer' });
  assert.equal(r.ok, true);
  assert.equal((r.evidence as { score: number }).score, 0.9);
});

test('LlmJudgeVerifier rejects malformed and out-of-range scores', async () => {
  const model = new MockModel({ responses: [
    { message: { role: 'assistant', content: '0.9 because it is good' }, finishReason: 'stop' },
    { message: { role: 'assistant', content: '1.2' }, finishReason: 'stop' },
  ] });
  const verifier = new LlmJudgeVerifier(model, 'rubric');
  const malformed = await verifier.verify({ goal, result: 'x' });
  const outOfRange = await verifier.verify({ goal, result: 'x' });
  assert.equal(malformed.ok, false);
  assert.equal(outOfRange.ok, false);
  assert.match(malformed.reason ?? '', /invalid score/);
  assert.match(outOfRange.reason ?? '', /invalid score/);
});
