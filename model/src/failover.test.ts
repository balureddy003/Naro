import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failover, retrying, withRetry } from './failover.ts';
import { MockModel, textResponse } from './mock-model.ts';

const ok = (text: string) => textResponse(text);
const boom = () => { throw new Error('provider down'); };

test('failover: first healthy lane answers', async () => {
  const m = failover([
    new MockModel({ id: 'dead', respond: boom }),
    new MockModel({ id: 'alive', responses: [ok('hello')] }),
  ]);
  const res = await m.chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.message.content, 'hello');
});

test('failover: circuit opens after tripAfter, half-opens after resetMs', async () => {
  let t = 0;
  let calls = 0;
  const lane = new MockModel({ id: 'flaky', respond: () => { calls++; throw new Error('down'); } });
  const m = failover([lane, new MockModel({ id: 'backup', responses: [ok('b'), ok('b'), ok('b')] })],
    { tripAfter: 2, resetMs: 100, nowMs: () => t });

  await m.chat({ messages: [{ role: 'user', content: 'x' }] }); // lane fails once → backup
  await m.chat({ messages: [{ role: 'user', content: 'x' }] }); // lane fails twice → circuit opens
  assert.equal(calls, 2);
  await m.chat({ messages: [{ role: 'user', content: 'x' }] }); // circuit open → skipped
  assert.equal(calls, 2);
  t += 150; // reset window passes → half-open probe
  await m.chat({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(calls, 3);
});

test('failover: all lanes down → last error surfaces', async () => {
  const m = failover([new MockModel({ respond: boom }), new MockModel({ respond: boom })]);
  await assert.rejects(() => m.chat({ messages: [{ role: 'user', content: 'x' }] }), /provider down/);
});

test('capabilities are the intersection — a weaker fallback narrows the surface', () => {
  const m = failover([
    new MockModel({ capabilities: ['chat', 'tool-calling', 'vision'] }),
    new MockModel({ capabilities: ['chat'] }),
  ]);
  assert.equal(m.capabilities.has('chat'), true);
  assert.equal(m.capabilities.has('tool-calling'), false);
  assert.equal(m.capabilities.has('vision'), false);
});

test('withRetry retries transient failures then succeeds', async () => {
  let n = 0;
  const r = await withRetry(() => { n++; if (n < 3) throw new Error('flake'); return Promise.resolve('ok'); },
    { attempts: 5, delayMs: 1 });
  assert.equal(r, 'ok');
  assert.equal(n, 3);
});

test('retrying() wraps a model', async () => {
  let n = 0;
  const m = retrying(new MockModel({ respond: () => { n++; if (n === 1) throw new Error('flake'); return ok('fine'); } }),
    { attempts: 3, delayMs: 1 });
  const res = await m.chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.message.content, 'fine');
});
