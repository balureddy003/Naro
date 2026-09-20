import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_STATES, TRANSITIONS,
  canTransition, assertTransition, isTerminal, isStopped,
} from './state.ts';
import { InvalidTransitionError } from './errors.ts';

test('every transition target is a real state', () => {
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    for (const to of targets) {
      assert.ok(AGENT_STATES.includes(to as never), `${from} → ${to} is not a valid state`);
    }
  }
});

test('happy path: a full agent loop is legal', () => {
  const path = [
    'CREATED', 'INITIALIZING', 'UNDERSTANDING', 'PLANNING',
    'WAITING_FOR_CONTEXT', 'REASONING', 'WAITING_FOR_PERMISSION',
    'ACTING', 'OBSERVING', 'VERIFYING', 'REASONING', 'COMPLETED',
  ] as const;
  for (let i = 0; i + 1 < path.length; i++) {
    assert.ok(canTransition(path[i]!, path[i + 1]!), `${path[i]} → ${path[i + 1]} should be legal`);
  }
});

test('replan loop: failure routes through REPLANNING back to PLANNING', () => {
  assert.ok(canTransition('VERIFYING', 'REPLANNING'));
  assert.ok(canTransition('REPLANNING', 'PLANNING'));
});

test('every action passes through WAITING_FOR_PERMISSION — no shortcut to ACTING', () => {
  assert.equal(canTransition('REASONING', 'ACTING'), false);
  assert.equal(canTransition('PLANNING', 'ACTING'), false);
  assert.ok(canTransition('WAITING_FOR_PERMISSION', 'ACTING'));
});

test('terminal states accept no outgoing transitions', () => {
  for (const to of AGENT_STATES) {
    assert.equal(canTransition('COMPLETED', to), false);
    assert.equal(canTransition('CANCELLED', to), false);
  }
});

test('PAUSED resumes only via RECOVERING; FAILED only via RECOVERING or CANCELLED', () => {
  assert.equal(canTransition('PAUSED', 'REASONING'), false);
  assert.ok(canTransition('PAUSED', 'RECOVERING'));
  assert.equal(canTransition('FAILED', 'ACTING'), false);
  assert.ok(canTransition('FAILED', 'RECOVERING'));
});

test('RECOVERING can restore to any reachable runtime state', () => {
  // INITIALIZING is excluded: you cannot resume into setup that never ran.
  const activeStates = AGENT_STATES.filter(
    (s) => !isStopped(s) && s !== 'CREATED' && s !== 'INITIALIZING' && s !== 'RECOVERING',
  );
  for (const s of activeStates) {
    assert.ok(canTransition('RECOVERING', s), `RECOVERING → ${s} should be legal`);
  }
});

test('assertTransition throws InvalidTransitionError on illegal moves', () => {
  assert.throws(() => assertTransition('COMPLETED', 'ACTING'), InvalidTransitionError);
  assert.throws(() => assertTransition('CREATED', 'ACTING'), InvalidTransitionError);
  assert.doesNotThrow(() => assertTransition('CREATED', 'INITIALIZING'));
});

test('isTerminal / isStopped classify states correctly', () => {
  assert.ok(isTerminal('COMPLETED') && isTerminal('CANCELLED'));
  assert.ok(!isTerminal('FAILED'));       // recoverable
  assert.ok(isStopped('PAUSED') && isStopped('FAILED'));
  assert.ok(!isStopped('REASONING'));
});
