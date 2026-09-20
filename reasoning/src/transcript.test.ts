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

test('multiple tool calls become one act-batch decision (parallel calls)', async () => {
  const model = new MockModel({
    responses: [
      { message: { role: 'assistant', content: '', toolCalls: [
        { id: 'c1', name: 'a', arguments: {} }, { id: 'c2', name: 'b', arguments: {} },
      ] }, finishReason: 'tool-calls', model: 'm' },
    ],
  });
  const r = new ReActReasoner(model, { tools: [{ name: 'a', description: '', parameters: {} }, { name: 'b', description: '', parameters: {} }] });
  const d = await r.decide(ctx());
  assert.equal(d.kind, 'act-batch');
  if (d.kind !== 'act-batch') return;
  assert.equal(d.actions.length, 2);
  assert.equal(d.actions[0]!.toolCallId, 'c1');
  assert.equal(d.actions[1]!.toolCallId, 'c2');
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

test('onChunk streams tokens live before the decision is made', async () => {
  const model = new MockModel({ responses: [
    { message: { role: 'assistant', content: 'the final answer' }, finishReason: 'stop', model: 'm' },
  ]});
  const chunks: string[] = [];
  const r = new ReActReasoner(model, { onChunk: (c) => chunks.push(c.delta) });
  const d = await r.decide(ctx());
  assert.equal(d.kind, 'complete');
  assert.ok(chunks.length > 1, 'streamed in pieces'); // MockModel splits words
  assert.equal(chunks.join(''), 'the final answer');
});
