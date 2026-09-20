import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiCompatibleProvider } from './provider.ts';

type FetchImpl = (url: string, init?: { body?: string }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string>;
}>;

/** A canned /chat/completions that echoes what it was sent. */
function fakeFetch(capture: (body: Record<string, unknown>) => void): typeof fetch {
  const impl: FetchImpl = async (_url, init) => {
    const sent = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    capture(sent);
    return {
      ok: true, status: 200,
      text: async () => '',
      json: async () => ({
        choices: [{ message: { content: 'pong', tool_calls: [
          { id: 'tc1', function: { name: 'ping', arguments: '{"x":1}' } },
        ] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        model: 'test-model',
      }),
    };
  };
  return impl as unknown as typeof fetch;
}

test('chat maps canonical request → wire → canonical response', async () => {
  let sent: Record<string, unknown> = {};
  const provider = new OpenAiCompatibleProvider({
    baseUrl: 'http://fake/v1', apiKey: 'k', fetchImpl: fakeFetch((b) => { sent = b; }),
  });
  const model = await provider.getModel('test-model');
  const res = await model.chat({
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'ping' },
      { role: 'tool', toolCallId: 'prev', content: 'result' },
    ],
    tools: [{ name: 'ping', description: 'pings', parameters: { type: 'object' } }],
    temperature: 0.2,
  });

  assert.equal(res.message.content, 'pong');
  assert.equal(res.finishReason, 'tool-calls');
  assert.equal(res.message.toolCalls?.[0]?.name, 'ping');
  assert.deepEqual(res.message.toolCalls?.[0]?.arguments, { x: 1 });
  assert.equal(res.usage?.totalTokens, 14);

  const msgs = sent['messages'] as { role: string; tool_call_id?: string }[];
  assert.equal(msgs[2]!.tool_call_id, 'prev');
  const tools = sent['tools'] as { function: { name: string } }[];
  assert.equal(tools[0]!.function.name, 'ping');
  assert.equal(sent['temperature'], 0.2);
});

test('sse streaming yields deltas then done', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"hel"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}',
    'data: [DONE]', '',
  ].join('\n');
  const fetchImpl = (async () => ({
    ok: true, status: 200, text: async () => '',
    json: async () => ({}),
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
  })) as unknown as typeof fetch;

  const provider = new OpenAiCompatibleProvider({ baseUrl: 'http://fake/v1', fetchImpl });
  const model = await provider.getModel('m');
  let text = '';
  let done = false;
  for await (const chunk of model.stream!({ messages: [{ role: 'user', content: 'hi' }] })) {
    text += chunk.delta;
    done = chunk.done;
  }
  assert.equal(text, 'hello');
  assert.ok(done);
});

test('provider errors surface as NaroError, not silent data', async () => {
  const fetchImpl = (async () => ({ ok: false, status: 500, text: async () => 'boom', json: async () => ({}) })) as unknown as typeof fetch;
  const model = await new OpenAiCompatibleProvider({ baseUrl: 'http://fake/v1', fetchImpl }).getModel('m');
  await assert.rejects(model.chat({ messages: [] }), /500/);
});
