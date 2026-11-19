import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockModel, type ChatRequest, type ChatResponse } from '@naro/model';
import { AgentRunner } from '@naro/runtime';
import { transactionCategorizer, type CategorizeInput } from './transaction-categorizer.ts';

const CHART = ['Meals & Entertainment', 'Office Supplies', 'Travel', 'Software & Subscriptions'];

const INPUT: CategorizeInput = {
  transaction: { description: 'UBER *TRIP 8832', amount: 24.50, currency: 'USD', date: '2026-01-15' },
  categories: CHART,
  history: [
    { description: 'UBER *TRIP 1021', category: 'Travel' },
    { description: 'LYFT *RIDE', category: 'Travel' },
    { description: 'STAPLES #441', category: 'Office Supplies' },
  ],
};

/** Scripted two-step: consult history, then answer. */
function scriptedModel(answer: string): MockModel {
  return new MockModel({
    respond: (req: ChatRequest): ChatResponse => {
      const sawToolResult = req.messages.some((m) => m.role === 'tool');
      if (!sawToolResult) {
        return {
          message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'lookup_history', arguments: { query: 'UBER TRIP' } }] },
          finishReason: 'tool-calls',
        };
      }
      return { message: { role: 'assistant', content: answer }, finishReason: 'stop' };
    },
  });
}

test('milestone 1: a categorizer run completes with a verified category, grounded in history', async () => {
  const deps = transactionCategorizer.build(INPUT, { cheap: scriptedModel('Travel') });
  const runner = new AgentRunner(deps);
  const result = await runner.run();

  assert.equal(result.status, 'completed');
  assert.equal(result.result, 'Travel');

  // The verifier actually ran — and passed on evidence, not vibes.
  const verification = result.events.find((e) => e.type === 'verification.completed');
  assert.ok(verification, 'expected a verification.completed event');
  assert.equal((verification!.data as { ok: boolean }).ok, true);

  // The tool call went through the gate: permission before execution.
  const types = result.events.map((e) => e.type);
  assert.ok(types.indexOf('permission.requested') < types.indexOf('action.started'));
  // The model consulted history — the observation carries the matches.
  const obs = result.events.find((e) => e.type === 'observation.created');
  const output = (obs!.data as { observation: { output: unknown } }).observation.output;
  assert.ok(Array.isArray(output) && (output as { category: string }[]).some((m) => m.category === 'Travel'));
});

test('a category outside the allowed set fails verification → replans → corrects', async () => {
  let calls = 0;
  const wobbly = new MockModel({
    respond: (req: ChatRequest): ChatResponse => {
      const sawToolResult = req.messages.some((m) => m.role === 'tool');
      calls++;
      if (!sawToolResult) {
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'lookup_history', arguments: { query: 'UBER' } }] }, finishReason: 'tool-calls' };
      }
      return { message: { role: 'assistant', content: calls > 2 ? 'Travel' : 'Limousine Services' }, finishReason: 'stop' };
    },
  });
  const deps = transactionCategorizer.build(INPUT, { cheap: wobbly });
  const result = await new AgentRunner(deps).run();

  assert.equal(result.status, 'completed');
  assert.equal(result.result, 'Travel');
  // The first answer failed verification — the journal shows the replan.
  const failed = result.events.find((e) => e.type === 'verification.completed' && (e.data as { ok: boolean }).ok === false);
  assert.ok(failed, 'expected a failed verification for the out-of-set answer');
  assert.match((failed!.data as { reason?: string }).reason ?? '', /not in the allowed set/);
});

test('low-confidence answers fail verification — the escalation signal', async () => {
  const unsure = new MockModel({
    respond: (req: ChatRequest): ChatResponse => {
      const sawToolResult = req.messages.some((m) => m.role === 'tool');
      if (!sawToolResult) {
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'lookup_history', arguments: { query: 'UBER' } }] }, finishReason: 'tool-calls' };
      }
      return { message: { role: 'assistant', content: '{"category":"Travel","confidence":0.2}' }, finishReason: 'stop' };
    },
  });
  const strong = new MockModel({
    respond: (): ChatResponse => ({ message: { role: 'assistant', content: 'Travel' }, finishReason: 'stop' }),
  });
  const deps = transactionCategorizer.build(
    { ...INPUT, confidenceFloor: 0.7 },
    { cheap: unsure, strong, escalateAfter: 1 },
  );
  const result = await new AgentRunner(deps).run();

  assert.equal(result.status, 'completed');
  assert.equal(result.result, 'Travel');
  // Cheap tier's low-confidence answer failed verification, strong tier
  // answered — the escalation path exercised end to end.
  const failures = result.events.filter((e) => e.type === 'verification.completed' && !(e.data as { ok: boolean }).ok);
  assert.ok(failures.length >= 1);
});

test('least privilege: only the template tools, only the declared grant', async () => {
  const nosy = new MockModel({
    respond: (): ChatResponse => ({
      message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'read_file', arguments: { path: '/etc/passwd' } }] },
      finishReason: 'tool-calls',
    }),
  });
  const deps = transactionCategorizer.build(INPUT, { cheap: nosy });
  const result = await new AgentRunner(deps).run();

  // The hallucinated tool is denied at the gate — the run can't pass it.
  const denied = result.events.find((e) => e.type === 'action.denied');
  assert.ok(denied, 'expected the unknown tool call to be denied');
  assert.match((denied!.data as { reason?: string }).reason ?? '', /no registered tool/);
});
