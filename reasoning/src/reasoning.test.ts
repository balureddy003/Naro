import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoal, createObservation, createTask,
  type ReasoningContext, type Task,
} from '@naro/core';
import { MockModel, textResponse, type ChatResponse } from '@naro/model';
import { ReActReasoner } from './react.ts';
import { PlanExecuteReasoner } from './plan-execute.ts';
import { ReflectionReasoner } from './reflect.ts';

function mkCtx(partial: Partial<ReasoningContext> = {}): ReasoningContext {
  return {
    agentId: 'a1',
    goal: createGoal({ description: 'add two numbers', successCriteria: ['answer is 42'] }),
    state: 'REASONING',
    tasks: [],
    observations: [],
    context: [],
    iteration: 0,
    ...partial,
  };
}

const toolCallingResponse: ChatResponse = {
  message: { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'calculator', arguments: { a: 40, b: 2 } }] },
  finishReason: 'tool-calls',
};

test('react: tool call becomes an act decision targeting tool://', async () => {
  const model = new MockModel({ responses: [toolCallingResponse] });
  const r = new ReActReasoner(model);
  const d = await r.decide(mkCtx());
  assert.equal(d.kind, 'act');
  if (d.kind === 'act') {
    assert.equal(d.action.target, 'tool://calculator');
    assert.deepEqual(d.action.input, { a: 40, b: 2 });
  }
});

test('react: plain text answer completes with the result', async () => {
  const model = new MockModel({
    respond: (req) => req.messages.some((m) => m.role === 'tool')
      ? textResponse('The answer is 42')
      : toolCallingResponse,
  });
  const r = new ReActReasoner(model);
  await r.decide(mkCtx());
  const obs = createObservation({ actionId: 'c1', source: 'tool://calculator', kind: 'tool-result', success: true, output: 42 });
  const d = await r.decide(mkCtx({ observations: [obs] }));
  assert.deepEqual(d, { kind: 'complete', result: 'The answer is 42' });
});

test('react: multiple tool calls queue and drain one per cycle', async () => {
  const multi: ChatResponse = {
    message: { role: 'assistant', content: '', toolCalls: [
      { id: 'c1', name: 'a', arguments: {} },
      { id: 'c2', name: 'b', arguments: {} },
    ] },
    finishReason: 'tool-calls',
  };
  const model = new MockModel({ responses: [multi] });
  const r = new ReActReasoner(model);
  const d1 = await r.decide(mkCtx());
  const d2 = await r.decide(mkCtx()); // no model call — drains queue
  assert.equal(d1.kind, 'act');
  assert.equal(d2.kind, 'act');
  if (d1.kind === 'act' && d2.kind === 'act') {
    assert.equal(d1.action.target, 'tool://a');
    assert.equal(d2.action.target, 'tool://b');
  }
});

test('plan-execute: plans once, then dispatches task-bound actions', async () => {
  const plan = JSON.stringify([
    { description: 'compute', action: { capability: 'tool.invoke', target: 'tool://calculator', input: { a: 40, b: 2 } } },
    { description: 'store', action: { capability: 'env.set', target: 'env://local/answer', input: 42 } },
  ]);
  const model = new MockModel({ responses: [textResponse(plan)] });
  const r = new PlanExecuteReasoner(model);

  const d1 = await r.decide(mkCtx());
  assert.equal(d1.kind, 'plan');
  if (d1.kind !== 'plan') return;
  assert.equal(d1.tasks.length, 2);

  const t1: Task = createTask({ goalId: 'g', description: 'compute', metadata: { action: d1.tasks[0]!.metadata?.['action'] } });
  const d2 = await r.decide(mkCtx({ tasks: [t1] }));
  assert.equal(d2.kind, 'act');
  if (d2.kind === 'act') assert.equal(d2.action.taskId, t1.id);

  t1.status = 'completed';
  const d3 = await r.decide(mkCtx({ tasks: [t1] }));
  assert.equal(d3.kind, 'complete');
});

test('plan-execute: malformed plan fails honestly', async () => {
  const model = new MockModel({ responses: [textResponse('not json at all')] });
  const d = await new PlanExecuteReasoner(model).decide(mkCtx());
  assert.equal(d.kind, 'fail');
});

test('reflection: failures generate lessons injected into later prompts', async () => {
  let lastSystemOrUser = '';
  const model = new MockModel({
    respond: (req) => {
      const joined = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      // the critic prompt asks for a one-line lesson; answer it with text
      if (joined.includes('One sentence')) return textResponse('narrow the input and retry');
      lastSystemOrUser = joined;
      return toolCallingResponse;
    },
  });
  const r = new ReflectionReasoner(model);

  const failObs = createObservation({ actionId: 'x', source: 'tool://deploy', kind: 'tool-result', success: false, error: 'permission denied' });
  await r.decide(mkCtx({ observations: [failObs] }));
  assert.match(lastSystemOrUser, /LESSONS FROM PRIOR FAILURES/);
  await r.decide(mkCtx({ observations: [failObs] })); // same obs — reflected once only
});
