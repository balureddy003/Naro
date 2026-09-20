import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask, isTaskReady, type Task } from './task.ts';

function mapOf(...tasks: Task[]): ReadonlyMap<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

test('a task with no dependencies is ready immediately', () => {
  const t = createTask({ goalId: 'g1', description: 'solo' });
  assert.ok(isTaskReady(t, mapOf(t)));
});

test('a task waits until all dependencies complete', () => {
  const a = createTask({ goalId: 'g1', description: 'first' });
  const b = createTask({ goalId: 'g1', description: 'second', dependsOn: [a.id] });
  assert.equal(isTaskReady(b, mapOf(a, b)), false);
  a.status = 'completed';
  assert.ok(isTaskReady(b, mapOf(a, b)));
});

test('a running task is not "ready" — readiness is derived from created/ready only', () => {
  const t = createTask({ goalId: 'g1', description: 'x' });
  t.status = 'running';
  assert.equal(isTaskReady(t, mapOf(t)), false);
});
