import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiModel } from './model.ts';

const fakeFetch = (impl: (body: unknown) => object) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(impl(calls.at(-1)!.body)), { status: 200 });
  }) as typeof fetch;
  return { f, calls };
};

test('system hoists to systemInstruction; assistant becomes model role', async () => {
  const { f, calls } = fakeFetch(() => ({
    candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
  }));
  const m = new GeminiModel('gemini-2.0-flash', { fetchImpl: f, apiKey: 'k' });
  const res = await m.chat({ messages: [
    { role: 'system', content: 'be terse' },
    { role: 'user', content: 'hello' },
  ]});
  const body = calls[0]!.body as { systemInstruction?: { parts: { text: string }[] }; contents: { role: string }[] };
  assert.equal(body.systemInstruction!.parts[0]!.text, 'be terse');
  assert.equal(body.contents[0]!.role, 'user');
  assert.equal(res.message.content, 'hi');
  assert.equal(res.usage?.totalTokens, 4);
  assert.match(calls[0]!.url, /generateContent\?key=k/);
});

test('functionCall parts become toolCalls; results pair by name', async () => {
  const { f, calls } = fakeFetch(() => ({
    candidates: [{ content: { parts: [{ functionCall: { name: 'calc', args: { a: 1 } } }] }, finishReason: 'STOP' }],
  }));
  const m = new GeminiModel('m', { fetchImpl: f });
  const res = await m.chat({ messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'calc', description: '', parameters: {} }] });
  assert.equal(res.finishReason, 'tool-calls');
  assert.equal(res.message.toolCalls![0]!.id, 'calc'); // name-based id
  assert.equal(res.message.toolCalls![0]!.name, 'calc');

  // now the tool result maps back to a functionResponse part
  await m.chat({ messages: [
    { role: 'user', content: 'x' },
    { role: 'assistant', content: '', toolCalls: res.message.toolCalls },
    { role: 'tool', toolCallId: 'calc', content: '42' },
  ]});
  const contents = (calls[1]!.body as { contents: { role: string; parts: object[] }[] }).contents;
  const fr = contents.at(-1)!.parts[0] as { functionResponse: { name: string; response: { result: string } } };
  assert.equal(fr.functionResponse.name, 'calc');
  assert.equal(fr.functionResponse.response.result, '42');
});

test('provider errors become NaroError', async () => {
  const f = (async () => new Response('quota', { status: 429 })) as typeof fetch;
  const m = new GeminiModel('m', { fetchImpl: f });
  await assert.rejects(m.chat({ messages: [{ role: 'user', content: 'x' }] }), /429/);
});

test('structured output maps to responseMimeType + responseSchema', async () => {
  let sent: Record<string, unknown> = {};
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
    }), { status: 200 });
  };
  const model = new GeminiModel('gemini-x', { fetchImpl: fetchImpl as typeof fetch });
  await model.chat({
    messages: [{ role: 'user', content: 'give json' }],
    responseFormat: { type: 'schema', schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } } },
  });
  const gen = sent['generationConfig'] as Record<string, unknown>;
  assert.equal(gen['responseMimeType'], 'application/json');
  assert.deepEqual(gen['responseSchema'], { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } });
});

test('embed batches texts through batchEmbedContents and returns ordered vectors', async () => {
  const { f, calls } = fakeFetch((body) => {
    const reqs = (body as { requests: { model: string; content: { parts: { text: string }[] } }[] }).requests;
    return { embeddings: reqs.map((r) => ({ values: [r.content.parts[0]!.text.length, 0] })) };
  });
  const m = new GeminiModel('gemini-embedding-001', { fetchImpl: f, apiKey: 'k' });
  const vectors = await m.embed(['a', 'bb']);
  assert.deepEqual(vectors, [[1, 0], [2, 0]]);
  const body = calls[0]!.body as { requests: { model: string }[] };
  assert.equal(body.requests[0]!.model, 'models/gemini-embedding-001');
  assert.match(calls[0]!.url, /batchEmbedContents\?key=k/);
});

test('embed surfaces provider errors as NaroError', async () => {
  const f = (async () => new Response('bad request', { status: 400 })) as typeof fetch;
  const m = new GeminiModel('gemini-embedding-001', { fetchImpl: f });
  await assert.rejects(m.embed(['x']), /400/);
});
