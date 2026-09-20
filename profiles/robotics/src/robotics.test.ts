import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal, createAction, type ExecContext } from '@naro/core';
const GOAL = createGoal({ description: 'test goal' });
import { GridSimDriver, RoboticsEnvironment } from './index.ts';

const ctx: ExecContext = { agentId: 'a', goalId: 'g' , goal: GOAL, grants: []};
const act = (cap: string, input: unknown) =>
  createAction('a', { capability: cap, target: `env://robot/${cap}`, input });

const env = (size = 5, walls: [number, number][] = []) =>
  new RoboticsEnvironment(new GridSimDriver({ size, walls }));

test('sense → act → sense shows real motion on the grid', async () => {
  const e = env();
  const s0 = await e.execute(act('robot.sense', {}), ctx);
  assert.deepEqual((s0.output as { pose: object }).pose, { x: 0, y: 0, heading: 0 });
  // heading 0 = north (y-1) is out of bounds — turn east first
  await e.execute(act('robot.act', { move: 'turn_right' }), ctx);
  const mv = await e.execute(act('robot.act', { move: 'forward', amount: 2 }), ctx);
  assert.equal(mv.success, true);
  assert.deepEqual((mv.output as { pose: object }).pose, { x: 2, y: 0, heading: 90 });
});

test('walls and bounds refuse the move, honestly', async () => {
  const e = env(5, [[1, 0]]);
  await e.execute(act('robot.act', { move: 'turn_right' }), ctx);
  const o = await e.execute(act('robot.act', { move: 'forward' }), ctx);
  assert.equal(o.success, false);
  assert.match(o.error ?? '', /wall/);
});

test('estop latches; act refuses until gated reset re-arms', async () => {
  const e = env();
  await e.execute(act('robot.estop', {}), ctx);
  const denied = await e.execute(act('robot.act', { move: 'turn_left' }), ctx);
  assert.equal(denied.success, false);
  assert.match(denied.error ?? '', /estop latched/);
  await e.execute(act('robot.reset', {}), ctx);
  const ok = await e.execute(act('robot.act', { move: 'turn_left' }), ctx);
  assert.equal(ok.success, true);
});

test('GridSimDriver doubles as a TreeSearch simulator world model', async () => {
  // The same deterministic sim that drives the env can predict outcomes:
  const sim = new GridSimDriver({ size: 5 });
  sim.act({ move: 'turn_right' });
  const predicted = sim.act({ move: 'forward', amount: 3 });
  assert.deepEqual(predicted.pose, { x: 3, y: 0, heading: 90 });
});

test('emergencyStop() is out-of-band — no policy, grants, or approvals', async () => {
  const env = new RoboticsEnvironment(new GridSimDriver({ size: 5 }));
  await env.emergencyStop(); // operator channel — never touches policy
  const o = await env.execute(act('robot.act', { move: 'forward' }), ctx);
  assert.equal(o.success, false);
  assert.match(o.error ?? '', /estop/);
  await env.resetSafety();
  const o2 = await env.execute(act('robot.act', { move: 'backward' }), ctx);
  assert.equal(o2.success, true);
});
