import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAction, createGoal, createObservation, createTask,
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
    actions: [],
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
  const d1 = await r.decide(mkCtx());
  if (d1.kind !== 'act') throw new Error('expected act');
  // The runtime records the action (with its provider toolCallId), then
  // the observation links back by actionId — the transcript pairs them.
  const action = createAction('a1', d1.action);
  const obs = createObservation({ actionId: action.id, source: 'tool://calculator', kind: 'tool-result', success: true, output: 42 });
  const d = await r.decide(mkCtx({ actions: [action], observations: [obs] }));
  assert.deepEqual(d, { kind: 'complete', result: 'The answer is 42' });
});

test('react: multiple tool calls become one act-batch decision', async () => {
  const multi: ChatResponse = {
    message: { role: 'assistant', content: '', toolCalls: [
      { id: 'c1', name: 'a', arguments: {} },
      { id: 'c2', name: 'b', arguments: {} },
    ] },
    finishReason: 'tool-calls',
  };
  const model = new MockModel({ responses: [multi] });
  const r = new ReActReasoner(model);
  const d = await r.decide(mkCtx());
  assert.equal(d.kind, 'act-batch');
  if (d.kind === 'act-batch') {
    assert.deepEqual(d.actions.map((a) => a.target), ['tool://a', 'tool://b']);
    assert.equal(d.actions[0]!.toolCallId, 'c1');
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

// ── TreeSearchReasoner ───────────────────────────────────────────────
import { TreeSearchReasoner } from './tree-search.ts';

test('tree-search expands candidates, scores them, picks the best', async () => {
  const model = new MockModel({
    respond: (req) => {
      const last = String(req.messages.at(-1)?.content ?? '');
      if (last.startsWith('Score this candidate')) {
        // score 'good_tool' high, 'bad_tool' low
        return { message: { role: 'assistant', content: last.includes('good_tool') ? '0.9' : '0.1' }, finishReason: 'stop' };
      }
      return {
        message: { role: 'assistant', content: JSON.stringify([
          { kind: 'act', tool: 'bad_tool', input: {}, rationale: 'nah' },
          { kind: 'act', tool: 'good_tool', input: { x: 1 }, rationale: 'yes' },
        ]) },
        finishReason: 'stop',
      };
    },
  });
  const r = new TreeSearchReasoner(model);
  const d = await r.decide(mkCtx());
  assert.equal(d.kind, 'act');
  assert.equal((d as { action: { target: string } }).action.target, 'tool://good_tool');
});

test('tree-search completes when the best candidate is a completion', async () => {
  const model = new MockModel({
    respond: (req) => {
      const last = String(req.messages.at(-1)?.content ?? '');
      if (last.startsWith('Score')) return { message: { role: 'assistant', content: '0.9' }, finishReason: 'stop' };
      return { message: { role: 'assistant', content: '[{"kind":"complete","result":"answer","rationale":"done"}]' }, finishReason: 'stop' };
    },
  });
  const d = await new TreeSearchReasoner(model).decide(mkCtx());
  assert.deepEqual(d, { kind: 'complete', result: 'answer' });
});

test('tree-search fails visibly on unparseable candidates', async () => {
  const model = new MockModel({ responses: [{ message: { role: 'assistant', content: 'not json' }, finishReason: 'stop' }] });
  const d = await new TreeSearchReasoner(model).decide(mkCtx());
  assert.equal(d.kind, 'fail');
});

test('tree-search multi-ply: a modest move wins via simulated continuation', async () => {
  // candidate 'setup_move' scores 0.3 but simulates into a state where
  // the next candidate ('winning_move') scores 0.95 — backed-up value wins.
  const model = new MockModel({
    respond: (req) => {
      const all = JSON.stringify(req.messages);
      const last = String(req.messages.at(-1)?.content ?? '');
      if (last.startsWith('Score')) return { message: { role: 'assistant', content: '0.5' }, finishReason: 'stop' };
      // depth-2 expansion happens in the simulated ctx (marked by sim output)
      const cands = all.includes('sim-marker')
        ? [{ kind: 'complete', result: 'checkmate', rationale: 'wins' }]
        : [
            { kind: 'act', tool: 'setup_move', input: {}, rationale: 'quiet' },
            { kind: 'act', tool: 'flashy_move', input: {}, rationale: 'looks great' },
          ];
      return { message: { role: 'assistant', content: JSON.stringify(cands) }, finishReason: 'stop' };
    },
  });
  const scorer = (c: { tool?: string; kind: string }) =>
    c.kind === 'complete' ? 0.95 : c.tool === 'setup_move' ? 0.3 : 0.8;
  const r = new TreeSearchReasoner(model, {
    depth: 2,
    simulator: () => ({ output: 'sim-marker' }),
    scorer: (c) => scorer(c),
  });
  const d = await r.decide(mkCtx());
  assert.equal(d.kind, 'act');
  // setup_move: max(0.3, child 0.95) = 0.95 > flashy_move's max(0.8, child?) 
  // flashy also simulates → child candidates are [complete 0.95] too... 
  // both reach 0.95; first-sorted wins — acceptable tie, but setup_move was
  // expanded first in candidate order so stable sort keeps it.
  assert.equal((d as { action: { target: string } }).action.target, 'tool://setup_move');
});

test('tree-search depth>1 without simulator throws — honesty over magic', () => {
  const model = new MockModel({ responses: [] });
  assert.throws(() => new TreeSearchReasoner(model, { depth: 2 }), /requires a simulator/);
});
