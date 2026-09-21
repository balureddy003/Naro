import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createObservation } from './observation.ts';

test('trust defaults by kind: runtime-authored evidence is system', () => {
  for (const kind of ['system', 'verification', 'human'] as const) {
    const o = createObservation({ source: 'x', kind, success: true });
    assert.equal(o.trust, 'system', kind);
  }
});

test('trust defaults to tool for results, env changes, and errors', () => {
  for (const kind of ['tool-result', 'env-change', 'error'] as const) {
    const o = createObservation({ source: 'x', kind, success: true });
    assert.equal(o.trust, 'tool', kind);
  }
});

test('an explicit trust level wins over the kind default', () => {
  const o = createObservation({ source: 'env://browser', kind: 'env-change', success: true, trust: 'external' });
  assert.equal(o.trust, 'external');
  const s = createObservation({ source: 'x', kind: 'system', success: true, trust: 'tool' });
  assert.equal(s.trust, 'tool');
});
