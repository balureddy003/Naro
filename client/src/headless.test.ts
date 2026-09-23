import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NaroClient } from './client.ts';
import { pollApprovals, pollRuns, watchRun } from './headless.ts';
import type { ApprovalRequest, RunEvent, RunSummary } from './types.ts';

function eventLine(seq: number): string {
  const e: RunEvent = { id: `e${seq}`, type: seq === 3 ? 'agent.completed' : 'x', seq, at: seq, agentId: 'a', goalId: 'g', runId: 'r1', data: {} };
  return `data: ${JSON.stringify(e)}\n\n`;
}

test('watchRun delivers events in order and stops after a terminal event', async () => {
  const fetchImpl = (async () => new Response(eventLine(1) + eventLine(2) + eventLine(3), { status: 200 })) as typeof fetch;
  const client = new NaroClient({ baseUrl: 'http://x', fetchImpl });
  const seen: number[] = [];
  await new Promise<void>((resolve) => {
    watchRun(client, 'r1', {
      onEvent: (e) => {
        seen.push(e.seq);
        if (e.type === 'agent.completed') resolve();
      },
    });
  });
  assert.deepEqual(seen, [1, 2, 3]);
});

test('watchRun reconnects from the last-seen seq after a dropped connection', async () => {
  let call = 0;
  const fetchImpl = (async (url: string | URL | Request) => {
    call++;
    if (call === 1) {
      // First connection drops after event 1 — no terminal event, body ends.
      return new Response(eventLine(1), { status: 200 });
    }
    // Reconnect must carry since=1, not start over.
    assert.match(String(url), /since=1/);
    return new Response(eventLine(2) + eventLine(3), { status: 200 });
  }) as typeof fetch;
  const client = new NaroClient({ baseUrl: 'http://x', fetchImpl });
  const seen: number[] = [];
  await new Promise<void>((resolve) => {
    watchRun(client, 'r1', {
      reconnectMs: 1,
      onEvent: (e) => {
        seen.push(e.seq);
        if (e.type === 'agent.completed') resolve();
      },
    });
  });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(call, 2);
});

test('watchRun stop() halts further delivery', async () => {
  let resolveSecond: (() => void) | undefined;
  const fetchImpl = (async () => {
    // A stream that never terminates on its own — stop() must be what ends it.
    return new Response(eventLine(1), { status: 200 });
  }) as typeof fetch;
  const client = new NaroClient({ baseUrl: 'http://x', fetchImpl });
  let count = 0;
  const stop = watchRun(client, 'r1', {
    reconnectMs: 5,
    onEvent: () => {
      count++;
      if (count === 2) { stop(); resolveSecond?.(); }
    },
  });
  await new Promise<void>((resolve) => { resolveSecond = resolve; });
  const countAtStop = count;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(count, countAtStop); // no further deliveries after stop()
});

test('pollRuns calls onData immediately and then on an interval', async () => {
  let calls = 0;
  const client = new NaroClient({
    baseUrl: 'http://x',
    fetchImpl: (async () => {
      calls++;
      return new Response(JSON.stringify([{ runId: `r${calls}` }] satisfies Partial<RunSummary>[]), { status: 200 });
    }) as typeof fetch,
  });
  const seen: string[] = [];
  const stop = pollRuns(client, { intervalMs: 10, onData: (runs) => seen.push(runs[0]!.runId) });
  await new Promise((r) => setTimeout(r, 35));
  stop();
  assert.ok(seen.length >= 2, `expected at least 2 polls, got ${seen.length}`);
  assert.deepEqual(seen, [...seen].sort()); // r1, r2, r3... monotonic, none skipped/reordered
});

test('pollApprovals stops firing after stop()', async () => {
  let calls = 0;
  const client = new NaroClient({
    baseUrl: 'http://x',
    fetchImpl: (async () => {
      calls++;
      return new Response(JSON.stringify([] satisfies ApprovalRequest[]), { status: 200 });
    }) as typeof fetch,
  });
  const stop = pollApprovals(client, { intervalMs: 5, onData: () => {} });
  await new Promise((r) => setTimeout(r, 15));
  stop();
  const callsAtStop = calls;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, callsAtStop);
});

test('poll onError is called on a failure but polling continues', async () => {
  let calls = 0;
  const client = new NaroClient({
    baseUrl: 'http://x',
    fetchImpl: (async () => {
      calls++;
      if (calls === 1) return new Response('boom', { status: 500 });
      return new Response('[]', { status: 200 });
    }) as typeof fetch,
  });
  let errors = 0;
  let gotData = false;
  const stop = pollRuns(client, {
    intervalMs: 5,
    onData: () => { gotData = true; },
    onError: () => { errors++; },
  });
  await new Promise((r) => setTimeout(r, 25));
  stop();
  assert.ok(errors >= 1);
  assert.ok(gotData);
});
