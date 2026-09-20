import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal } from './goal.ts';
import { createAction } from './action.ts';
import { createObservation } from './observation.ts';

test('createGoal fills defaults and prefixes the id', () => {
  const g = createGoal({ description: 'do a thing' });
  assert.match(g.id, /^goal_/);
  assert.deepEqual(g.constraints, []);
  assert.deepEqual(g.successCriteria, []);
  assert.equal(g.priority, 0);
});

test('createAction starts in requested state', () => {
  const a = createAction('agent_1', { capability: 'env.write', target: 'env://local/k', input: 1 });
  assert.equal(a.state, 'requested');
  assert.equal(a.actor, 'agent_1');
});

test('createObservation records evidence linked to its action', () => {
  const a = createAction('agent_1', { capability: 'env.read', target: 'env://local/k' });
  const o = createObservation({ actionId: a.id, source: 'env://local', kind: 'env-change', success: true, output: 1 });
  assert.equal(o.actionId, a.id);
  assert.equal(o.success, true);
});
