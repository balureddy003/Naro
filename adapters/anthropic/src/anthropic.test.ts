import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicModel } from './model.ts';

function fakeFetch(capture: (body: Record<string, unknown>) => void): typeof fetch {
  return (async (_url: string, init: { body: string }) => {
    capture(JSON.parse(init.body) as Record<string, unknown>);
    return {
      ok: true, status: 200, text: async () => '',
      json: async () => ({
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool_use', id: 'tu1', name: 'lookup', input: { q: 'x' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 9 },
        model: 'claude-test',
      }),
    };
  }) as unknown as typeof fetch;
}

test('chat maps canonical → anthropic wire → canonical', async () => {
  let sent: Record<string, unknown> = {};
  const model = new AnthropicModel('claude-test', {
    apiKey: 'k', fetchImpl: fakeFetch((b) => { sent = b; }),
  });
  const res = await model.chat({
    messages: [
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'look it up' },
      { role: 'tool', toolCallId: 'tu0', content: 'earlier result' },
    ],
    tools: [{ name: 'lookup', description: 'search', parameters: { type: 'object' } }],
    maxTokens: 512,
  });

  // canonical response
  assert.equal(res.message.content, 'checking');
  assert.equal(res.finishReason, 'tool-calls');
  assert.equal(res.message.toolCalls?.[0]?.name, 'lookup');
  assert.equal(res.usage?.inputTokens, 20);

  // wire shape: system hoisted, tool_result in user message, input_schema
  assert.equal(sent['system'], 'be terse');
  assert.equal(sent['max_tokens'], 512);
  const msgs = sent['messages'] as { role: string; content: unknown }[];
  assert.equal(msgs.length, 2); // system removed
  const toolResult = msgs[1]!.content as { type: string; tool_use_id: string }[];
  assert.equal(toolResult[0]!.type, 'tool_result');
  assert.equal(toolResult[0]!.tool_use_id, 'tu0');
  const tools = sent['tools'] as { input_schema: unknown }[];
  assert.ok(tools[0]!.input_schema);
});

test('SSE stream yields text deltas then done', async () => {
  const sse = [
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hel"}}',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}',
    'data: {"type":"message_stop"}', '',
  ].join('\n');
  const fetchImpl = (async () => ({
    ok: true, status: 200,
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
  })) as unknown as typeof fetch;
  const model = new AnthropicModel('m', { fetchImpl });
  let text = '';
  for await (const c of model.stream!({ messages: [{ role: 'user', content: 'hi' }] })) text += c.delta;
  assert.equal(text, 'hello');
});

test('provider errors surface as NaroError', async () => {
  const fetchImpl = (async () => ({ ok: false, status: 429, text: async () => 'rate limited' })) as unknown as typeof fetch;
  const model = new AnthropicModel('m', { fetchImpl });
  await assert.rejects(model.chat({ messages: [] }), /429/);
});
