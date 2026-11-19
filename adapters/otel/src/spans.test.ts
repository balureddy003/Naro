import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal, GENESIS_HASH, hashEvent, type EventDataMap, type EventType, type NaroEvent } from '@naro/core';
import { OtlpSpanExporter } from './spans.ts';

let seq = 0;
function ev<T extends EventType>(type: T, data: EventDataMap[T], extra: Partial<NaroEvent> = {}): NaroEvent {
  const unsigned = {
    id: `e${++seq}`, type, seq, at: 1_700_000_000_000 + seq * 10,
    agentId: 'a1', goalId: 'g1', runId: 'r1', prev: GENESIS_HASH, data, ...extra,
  };
  return { ...unsigned, hash: hashEvent(unsigned) } as NaroEvent<T>;
}

const action = { id: 'act1', agentId: 'a1', goalId: 'g1', capability: 'tool.invoke', target: 'tool://search', input: {}, state: 'requested', at: 0, idempotencyKey: 'k' };
const obs = { id: 'o1', actionId: 'act1', source: 'tool://search', kind: 'tool-result', success: true, at: 0, trust: 'tool' };

interface SpanBody {
  resourceSpans: { scopeSpans: { spans: {
    name: string; traceId: string; spanId: string; parentSpanId?: string;
    status: { code: number; message?: string };
    attributes: { key: string; value: { stringValue?: string; intValue?: string } }[];
    events: { name: string; attributes: { key: string; value: object }[] }[];
  }[] }[] }[];
}
const spansOf = (b: SpanBody) => b.resourceSpans[0]!.scopeSpans[0]!.spans;
const attrOf = (s: { attributes: { key: string; value: { stringValue?: string } }[] }, k: string) =>
  s.attributes.find((a) => a.key === k)?.value.stringValue;

function capture() {
  const sent: { url: string; body: SpanBody }[] = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) as SpanBody });
    return { ok: true, status: 200 };
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

test('a full run produces one agent span plus action spans, all in one trace', async () => {
  const { sent, fetchImpl } = capture();
  const exp = new OtlpSpanExporter({ endpoint: 'http://c:4318', serviceName: 'naro-test', fetchImpl });
  await exp.export([
    ev('agent.created', { name: 'a1' }),
    ev('goal.started', { goal: createGoal({ description: 'search things' }) }),
    ev('reasoning.started', { iteration: 0 }),
    ev('action.requested', { action: action as never }),
    ev('permission.requested', { action: action as never, policy: 'baseline' }),
    ev('action.permitted', { action: action as never, policy: 'baseline' }),
    ev('action.completed', { action: { ...action, state: 'completed' } as never, observation: obs as never }),
    ev('model.usage', { iteration: 0, usage: { inputTokens: 10, outputTokens: 5 }, totals: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0 } }),
    ev('agent.completed', { result: 'ok', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0 } }),
  ]);
  await exp.flush();

  assert.equal(sent[0]!.url, 'http://c:4318/v1/traces');
  const spans = sent.flatMap((b) => spansOf(b.body));
  const agent = spans.find((s) => s.name === 'invoke_agent a1')!;
  const tool = spans.find((s) => s.name === 'execute_tool search')!;
  assert.ok(agent && tool, 'expected agent + action spans');
  assert.equal(agent.traceId, tool.traceId, 'same trace');
  assert.equal(tool.parentSpanId, agent.spanId, 'action nests under the agent span');
  assert.equal(attrOf(agent, 'gen_ai.operation.name'), 'invoke_agent');
  assert.equal(attrOf(tool, 'gen_ai.tool.name'), 'search');
  assert.equal(attrOf(tool, 'gen_ai.tool.call.result'), 'success');
  assert.equal(attrOf(tool, 'naro.policy.engine'), 'baseline');
  assert.equal(agent.status.code, 1);
  // reasoning iterations + usage fold in as span events, not spans
  assert.ok(agent.events.some((e) => e.name === 'reasoning.iteration'));
  assert.ok(agent.events.some((e) => e.name === 'model.usage'));
});

test('a denied action ends its span immediately with an error status', async () => {
  const { sent, fetchImpl } = capture();
  const exp = new OtlpSpanExporter({ endpoint: 'http://c:4318', fetchImpl });
  await exp.export([
    ev('agent.created', { name: 'a1' }),
    ev('action.requested', { action: action as never }),
    ev('action.denied', { action: { ...action, state: 'denied' } as never, reason: 'env writes forbidden', policy: 'baseline' }),
    ev('agent.failed', { error: 'denied' }),
  ]);
  await exp.flush();
  const spans = sent.flatMap((b) => spansOf(b.body));
  const tool = spans.find((s) => s.name.startsWith('execute_tool'))!;
  assert.equal(tool.status.code, 2); // error
  assert.equal(tool.status.message, 'env writes forbidden');
  assert.equal(attrOf(tool, 'naro.policy.verdict'), 'denied');
});

test('delegated child run shares the trace and nests under the parent delegate span', async () => {
  const { sent, fetchImpl } = capture();
  const exp = new OtlpSpanExporter({ endpoint: 'http://c:4318', fetchImpl });
  const delegate = { ...action, id: 'act-del', capability: 'agent.delegate', target: 'agent://a2', input: { agent: 'a2', goal: 'sub' } };
  await exp.export([
    ev('agent.created', { name: 'a1' }),
    ev('action.requested', { action: delegate as never }),
    // child run events: same traceId, different runId + agentId
    ev('goal.started', { goal: createGoal({ description: 'sub' }) }, { runId: 'r2', agentId: 'a2', traceId: 'r1' }),
    ev('agent.completed', { result: 'sub-result' }, { runId: 'r2', agentId: 'a2', traceId: 'r1' }),
    ev('action.completed', { action: { ...delegate, state: 'completed' } as never, observation: { ...obs, actionId: 'act-del' } as never }),
  ]);
  await exp.flush();
  const spans = sent.flatMap((b) => spansOf(b.body));
  const parent = spans.find((s) => s.name === 'execute_tool a2')!;
  const child = spans.find((s) => s.name === 'invoke_agent a2')!;
  assert.ok(parent && child);
  assert.equal(child.traceId, parent.traceId, 'child joins the same trace');
  assert.equal(child.parentSpanId, parent.spanId, 'child nests under the delegate span');
});
