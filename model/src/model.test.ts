import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityNotSupportedError } from '@naro/core';
import { MockModel, textResponse } from './mock-model.ts';
import { chat, requireCapability, stream } from './model.ts';

test('chat passes through a scripted responder', async () => {
  const model = new MockModel({
    respond: (req) => textResponse(`echo:${req.messages.at(-1)?.content}`),
  });
  const res = await chat(model, { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.message.content, 'echo:hi');
});

test('canned responses are consumed in order', async () => {
  const model = new MockModel({ responses: [textResponse('one'), textResponse('two')] });
  assert.equal((await model.chat({ messages: [] })).message.content, 'one');
  assert.equal((await model.chat({ messages: [] })).message.content, 'two');
});

test('missing capabilities throw instead of silently degrading', async () => {
  const model = new MockModel({ capabilities: ['chat'] });
  assert.throws(() => requireCapability(model, 'embeddings'), CapabilityNotSupportedError);
  // tools offered but tool-calling not declared → rejected before the call
  await assert.rejects(
    chat(model, {
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 't', description: 'd', parameters: {} }],
    }),
    CapabilityNotSupportedError,
  );
});

test('streaming yields chunks ending with done', async () => {
  const model = new MockModel({ responses: [textResponse('hello world')] });
  const deltas: string[] = [];
  let done = false;
  for await (const chunk of stream(model, { messages: [] })) {
    deltas.push(chunk.delta);
    done = chunk.done;
  }
  assert.equal(deltas.join(''), 'hello world');
  assert.ok(done);
});

test('streaming on a non-streaming model is refused', async () => {
  const model = new MockModel({ capabilities: ['chat'] });
  await assert.rejects(async () => {
    for await (const _ of stream(model, { messages: [] })) { /* unreachable */ }
  }, CapabilityNotSupportedError);
});
