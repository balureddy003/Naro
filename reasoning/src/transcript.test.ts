import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, createGoal, createObservation, type ReasoningContext } from '@naro/core';
import { MockModel, type ChatRequest } from '@naro/model';
import { ReActReasoner } from './react.ts';

const GOAL = createGoal({ description: 'compute', successCriteria: ['done'] });
const ctx = (over: Partial<ReasoningContext> = {}): ReasoningContext => ({
  agentId: 'a1', goal: GOAL, state: 'REASONING',
  tasks: [], observations: [], actions: [], context: [], iteration: 0, ...over,
});

test('tool calls produce provider-faithful assistant + tool message pairs', async () => {
  const requests: ChatRequest[] = [];
  const model = new MockModel({
    respond: (req) => {
      requests.push(req);
      return requests.length === 1
        ? { message: { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'calc', arguments: { a: 1 } }] }, finishReason: 'tool-calls', model: 'm' }
        : { message: { role: 'assistant', content: 'done' }, finishReason: 'stop', model: 'm' };
    },
  });
  const reasoner = new ReActReasoner(model, {
    tools: [{ name: 'calc', description: 'math', parameters: {} }],
  });

  const d1 = await reasoner.decide(ctx());
  assert.equal(d1.kind, 'act');
  if (d1.kind !== 'act') return;
  // The provider call id must ride on the action.
  assert.equal(d1.action.toolCallId, 'call_1');

  // The runtime executes it and feeds back an action + observation.
  const action = createAction('a1', d1.action);
  const obs = createObservation({
    actionId: action.id, source: action.target, kind: 'tool-result',
    success: true, output: '2',
  });
  await reasoner.decide(ctx({ actions: [action], observations: [obs] }));

  const msgs = requests[1]!.messages;
  const assistant = msgs.find((m) => m.role === 'assistant' && m.toolCalls?.length);
  const tool = msgs.find((m) => m.role === 'tool');
  assert.ok(assistant, 'assistant tool_use message must precede the result');
  assert.equal(assistant!.toolCalls![0]!.id, 'call_1');
  assert.equal(assistant!.toolCalls![0]!.name, 'calc');
  assert.equal(tool!.toolCallId, 'call_1'); // result references the call id, not the action id
});

test('pending tool calls survive capture/restore (checkpoint round-trip)', async () => {
  const model = new MockModel({
    responses: [
      { message: { role: 'assistant', content: '', toolCalls: [
        { id: 'c1', name: 'a', arguments: {} }, { id: 'c2', name: 'b', arguments: {} },
      ] }, finishReason: 'tool-calls', model: 'm' },
    ],
  });
  const r1 = new ReActReasoner(model, { tools: [{ name: 'a', description: '', parameters: {} }, { name: 'b', description: '', parameters: {} }] });
  await r1.decide(ctx()); // queues c2 in pending
  const state = r1.captureState();

  const r2 = new ReActReasoner(model, { tools: [] });
  r2.restoreState(state);
  const d = await r2.decide(ctx());
  assert.equal(d.kind, 'act');
  if (d.kind === 'act') assert.equal(d.action.toolCallId, 'c2');
});

test('maxObservations windows the evidence without losing recent facts', async () => {
  const requests: ChatRequest[] = [];
  const model = new MockModel({ respond: (req) => {
    requests.push(req);
    return { message: { role: 'assistant', content: 'x' }, finishReason: 'stop', model: 'm' };
  }});
  const reasoner = new ReActReasoner(model, { maxObservations: 2 });
  const obs = [1, 2, 3, 4].map((i) => createObservation({
    source: 'env', kind: 'env-change', success: true, output: `o${i}`,
  }));
  await reasoner.decide(ctx({ observations: obs }));
  const tail = requests[0]!.messages.map((m) => JSON.stringify(m)).join('');
  assert.match(tail, /omitted/);
  assert.match(tail, /o4/);
  assert.doesNotMatch(tail, /o1[^0-9]/);
});
