import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaCheapTier, OLLAMA_CANDIDATES, verifyOllamaCapabilities } from './ollama.ts';

/** Canned OpenAI-compatible responses keyed by request shape. */
function mockOllama(handlers: {
  toolCalls?: boolean; validJson?: boolean; stream?: boolean; embeds?: boolean; down?: boolean;
}) {
  return (async (url: string, init?: { body?: string }) => {
    if (handlers.down) throw new Error('ECONNREFUSED');
    if (url.endsWith('/models')) {
      return { ok: true, json: async () => ({ data: [{ id: 'qwen2.5:3b' }] }) } as Response;
    }
    if (url.endsWith('/embeddings')) {
      if (!handlers.embeds) return { ok: false, status: 400, text: async () => 'model does not support embeddings' } as Response;
      return { ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }) } as Response;
    }
    const body = JSON.parse(init?.body ?? '{}') as { stream?: boolean; tools?: unknown[]; response_format?: unknown };
    if (body.stream) {
      if (!handlers.stream) return { ok: false, status: 400, text: async () => 'stream unsupported' } as Response;
      const line = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\ndata: [DONE]\n`;
      return { ok: true, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(line)); c.close(); } }) } as Response;
    }
    if (body.response_format) {
      const content = handlers.validJson ? '{"answer":"yes"}' : 'I cannot do JSON';
      return { ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }) } as Response;
    }
    if (body.tools) {
      const message = handlers.toolCalls
        ? { content: null, tool_calls: [{ id: 'c1', function: { name: 'echo', arguments: '{"text":"hello"}' } }] }
        : { content: 'hello' };
      return { ok: true, json: async () => ({ choices: [{ message, finish_reason: handlers.toolCalls ? 'tool_calls' : 'stop' }] }) } as Response;
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }) } as Response;
  }) as unknown as typeof fetch;
}

test('verifyOllamaCapabilities reports only what probes prove', async () => {
  const res = await verifyOllamaCapabilities({
    model: 'qwen2.5:3b', baseUrl: 'http://x/v1',
    fetchImpl: mockOllama({ toolCalls: true, validJson: true, stream: true, embeds: true }),
  });
  assert.equal(res.reachable, true);
  assert.deepEqual([...res.capabilities].sort(), ['chat', 'embeddings', 'streaming', 'structured-output', 'tool-calling'].sort());
  assert.deepEqual(res.failures, {});
});

test('verifyOllamaCapabilities degrades to chat-only when probes fail', async () => {
  const res = await verifyOllamaCapabilities({
    model: 'gemma2:2b', baseUrl: 'http://x/v1',
    fetchImpl: mockOllama({ toolCalls: false, validJson: false, stream: false, embeds: false }),
  });
  assert.deepEqual(res.capabilities, ['chat']);
  assert.ok('tool-calling' in res.failures && 'structured-output' in res.failures);
});

test('verifyOllamaCapabilities reports unreachable honestly — not an empty capability list', async () => {
  const res = await verifyOllamaCapabilities({
    model: 'qwen2.5:3b', baseUrl: 'http://x/v1',
    fetchImpl: mockOllama({ down: true }),
  });
  assert.equal(res.reachable, false);
  assert.ok(res.failures['reachability']);
});

test('ollamaCheapTier assembles a ReActReasoner with declared capabilities', () => {
  const { reasoner, label } = ollamaCheapTier({
    model: 'qwen2.5:3b', baseUrl: 'http://x/v1',
    capabilities: ['chat', 'tool-calling'],
    fetchImpl: mockOllama({ toolCalls: true }),
  });
  assert.equal(reasoner.strategy, 'react');
  assert.equal(label, 'ollama/qwen2.5:3b');
});

test('OLLAMA_CANDIDATES carries catalog facts, not claims', () => {
  assert.ok(OLLAMA_CANDIDATES.length > 0);
  assert.ok(OLLAMA_CANDIDATES.every((c) => c.tag && c.license));
});

// Live verification — the PRD-005 milestone-1 pass. Set NARO_OLLAMA=1
// (optionally OLLAMA_URL + OLLAMA_MODEL) with a running `ollama serve`
// and the model pulled; otherwise skipped like the pg suite.
const live = process.env['NARO_OLLAMA'] === '1';
test('live: verifyOllamaCapabilities against a real ollama serve', { skip: !live }, async () => {
  const model = process.env['OLLAMA_MODEL'] ?? 'qwen2.5:3b';
  const res = await verifyOllamaCapabilities({
    model,
    baseUrl: process.env['OLLAMA_URL'] ?? 'http://localhost:11434/v1',
  });
  assert.equal(res.reachable, true, `ollama not reachable: ${JSON.stringify(res.failures)}`);
  assert.ok(res.capabilities.includes('chat'));
  console.log(`verified ${model}:`, res.capabilities, res.failures);
});
