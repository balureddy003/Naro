import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retry, noRetry } from './retry.ts';

test('returns on first success without delay', async () => {
  const v = await retry(async () => 'ok', { attempts: 3, delayMs: 0 });
  assert.equal(v, 'ok');
});

test('retries until success', async () => {
  let n = 0;
  const v = await retry(async () => {
    if (++n < 3) throw new Error('flaky');
    return 'recovered';
  }, { attempts: 5, delayMs: 0 });
  assert.equal(v, 'recovered');
  assert.equal(n, 3);
});

test('throws the last error after exhausting attempts', async () => {
  await assert.rejects(
    retry(async () => { throw new Error('always'); }, { attempts: 3, delayMs: 0 }),
    /always/,
  );
});

test('shouldRetry gates which errors are retryable', async () => {
  let n = 0;
  await assert.rejects(
    retry(async () => { n++; throw new Error('fatal'); },
      { attempts: 5, delayMs: 0, shouldRetry: (e) => !(e instanceof Error && e.message === 'fatal') }),
    /fatal/,
  );
  assert.equal(n, 1);
});

test('abort signal interrupts the backoff sleep', async () => {
  const ac = new AbortController();
  const p = retry(async () => { throw new Error('x'); }, { attempts: 5, delayMs: 5000 }, ac.signal);
  ac.abort();
  await assert.rejects(p);
});
