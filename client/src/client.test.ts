import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NaroApiError, NaroClient } from './client.ts';

function fakeFetch(routes: Record<string, (init?: RequestInit) => { status: number; body: unknown } | { status: number; sse: string }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) return new Response('not found', { status: 404 });
    const result = routes[key]!(init);
    if ('sse' in result) {
      return new Response(result.sse, { status: result.status, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify(result.body), { status: result.status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test('the default fetchImpl is bound, not a bare reference — a browser\'s ' +
  'native fetch throws "Illegal invocation" if called unbound', async () => {
  // A real Node test can't reproduce a browser's fetch, but it can
  // reproduce the WebIDL receiver check that makes browser fetch fail
  // when called as `this.fetchImpl(...)` on a non-window `this` — that
  // check is exactly what caught this bug in a real browser. Patch the
  // global to enforce the same rule and confirm NaroClient's *default*
  // fetchImpl (no fetchImpl passed in) survives it.
  const realFetch = globalThis.fetch;
  const receiverCheckedFetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return realFetch(...args);
  };
  globalThis.fetch = receiverCheckedFetch as typeof fetch;
  try {
    const client = new NaroClient({ baseUrl: 'http://127.0.0.1:1' }); // no fetchImpl — uses the built-in default
    // Any network error here is fine (nothing is listening on :1); the
    // only failure this test cares about is "Illegal invocation", thrown
    // before the network call even happens.
    await assert.rejects(client.listRuns(), (e: unknown) => !(e instanceof TypeError && e.message === 'Illegal invocation'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('submitGoal posts JSON and returns the runId', async () => {
  const { fetchImpl, calls } = fakeFetch({
    '/goals': () => ({ status: 202, body: { runId: 'run_1' } }),
  });
  const client = new NaroClient({ baseUrl: 'http://x', token: 'tok', fetchImpl });
  const res = await client.submitGoal({ description: 'do the thing' });
  assert.equal(res.runId, 'run_1');
  assert.equal(calls[0]!.init?.method, 'POST');
  assert.equal((calls[0]!.init?.headers as Record<string, string>)['authorization'], 'Bearer tok');
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { description: 'do the thing' });
});

test('listRuns, getRun, getEvidence, listApprovals hit the right paths', async () => {
  const { fetchImpl, calls } = fakeFetch({
    '/runs/r1/evidence': () => ({ status: 200, body: { events: 1, chain: { ok: true, length: 1, unchained: 0 }, actions: [], counts: { actions: 0, denied: 0, verificationFailures: 0 } } }),
    '/runs/r1': () => ({ status: 200, body: { runId: 'r1', status: 'completed' } }),
    '/runs': () => ({ status: 200, body: [{ runId: 'r1' }] }),
    '/approvals': () => ({ status: 200, body: [] }),
  });
  const client = new NaroClient({ baseUrl: 'http://x', fetchImpl });
  assert.deepEqual(await client.listRuns(), [{ runId: 'r1' }]);
  assert.equal((await client.getRun('r1')).status, 'completed');
  assert.equal((await client.getEvidence('r1')).events, 1);
  assert.deepEqual(await client.listApprovals(), []);
  assert.ok(calls.some((c) => c.url.endsWith('/runs/r1/evidence')));
});

test('listRuns({traceId}) puts the filter on the query string', async () => {
  const { fetchImpl, calls } = fakeFetch({
    '/runs': () => ({ status: 200, body: [] }),
  });
  const client = new NaroClient({ baseUrl: 'http://x', fetchImpl });
  await client.listRuns({ traceId: 'trace_1' });
  assert.match(calls[0]!.url, /\/runs\?traceId=trace_1$/);
  await client.listRuns();
  assert.match(calls[1]!.url, /\/runs$/);
});

test('answerApproval posts the answer to the right id', async () => {
  const { fetchImpl, calls } = fakeFetch({
    '/approvals/appr_1': () => ({ status: 200, body: { ok: true } }),
  });
  const client = new NaroClient({ baseUrl: 'http://x', fetchImpl });
  const res = await client.answerApproval('appr_1', { approved: true, note: 'looks fine' });
  assert.equal(res.ok, true);
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { approved: true, note: 'looks fine' });
});

test('a non-2xx response throws NaroApiError with the status', async () => {
  const { fetchImpl } = fakeFetch({ '/runs/nope': () => ({ status: 404, body: { error: 'unknown run' } }) });
  const client = new NaroClient({ baseUrl: 'http://x', fetchImpl });
  await assert.rejects(client.getRun('nope'), (e: unknown) => e instanceof NaroApiError && e.status === 404);
});

test('streamEvents parses SSE "data:" lines into RunEvent objects', async () => {
  const sse = `data: ${JSON.stringify({ id: 'e1', type: 'goal.started', seq: 1, at: 1, agentId: 'a', goalId: 'g', runId: 'r1', data: {} })}\n\n`
    + `data: ${JSON.stringify({ id: 'e2', type: 'agent.completed', seq: 2, at: 2, agentId: 'a', goalId: 'g', runId: 'r1', data: {} })}\n\n`;
  const { fetchImpl, calls } = fakeFetch({ '/runs/r1/events': () => ({ status: 200, sse }) });
  const client = new NaroClient({ baseUrl: 'http://x', fetchImpl });
  const seen: number[] = [];
  for await (const e of client.streamEvents('r1')) seen.push(e.seq);
  assert.deepEqual(seen, [1, 2]);
  assert.ok(!calls[0]!.url.includes('since=')); // no cursor by default
});

test('streamEvents(runId, {since}) puts the cursor on the query string', async () => {
  const { fetchImpl, calls } = fakeFetch({ '/runs/r1/events': () => ({ status: 200, sse: '' }) });
  const client = new NaroClient({ baseUrl: 'http://x', fetchImpl });
  for await (const _e of client.streamEvents('r1', { since: 5 })) { /* empty stream */ }
  assert.match(calls[0]!.url, /since=5/);
});

test('a malformed SSE line is dropped, not fatal to the stream', async () => {
  const good = JSON.stringify({ id: 'e1', type: 'x', seq: 1, at: 1, agentId: 'a', goalId: 'g', runId: 'r1', data: {} });
  const sse = `data: not json\n\ndata: ${good}\n\n`;
  const { fetchImpl } = fakeFetch({ '/runs/r1/events': () => ({ status: 200, sse }) });
  const client = new NaroClient({ baseUrl: 'http://x', fetchImpl });
  const seen: unknown[] = [];
  for await (const e of client.streamEvents('r1')) seen.push(e);
  assert.equal(seen.length, 1);
});
