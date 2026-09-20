import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NaroEvent } from '@naro/core';
import { eventExporterContract } from '@naro/contract-tests';
import { SqliteEventStore } from './sqlite-event-store.ts';

const ev = (seq: number, runId = 'r1'): NaroEvent => ({
  id: `e${seq}-${runId}`, type: 'agent.created', seq, at: Date.now(),
  agentId: 'a1', goalId: 'g1', runId, data: { name: 't' },
});

test('journal persists and replays in seq order, filterable by run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-ev-'));
  const path = join(dir, 'ev.db');
  const s1 = new SqliteEventStore(path);
  await s1.export([ev(1), ev(2)]);
  await s1.export([ev(1, 'r2')]);
  await s1.flush();
  s1.close();

  // Fresh instance — the journal survived the process boundary.
  const s2 = new SqliteEventStore(path);
  const all = s2.history();
  assert.equal(all.length, 3);
  assert.equal(s2.history({ runId: 'r2' }).length, 1);
  assert.equal(s2.runs().length, 2);
});

test('later exports land in the same journal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-ev-'));
  const s = new SqliteEventStore(join(dir, 'ev.db'));
  await s.export([ev(9)]);
  await s.export([ev(3)]);
  await s.flush();
  assert.equal(s.history().length, 2);
});

eventExporterContract('SqliteEventStore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-ev-'));
  return new SqliteEventStore(join(dir, 'ev.db'));
});
