import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffReports, JsonlReportStore } from './regression.ts';
import type { EvalReport, EvalResult } from './benchmark.ts';

const res = (caseId: string, ok: boolean): EvalResult => ({
  caseId, ok, status: ok ? 'completed' : 'failed',
  metrics: { totalEvents: 5, iterations: 1, actionsRequested: 1, actionsDenied: 0,
    approvalsRequested: 0, observations: 1, verificationsPassed: 1,
    verificationsFailed: 0, replans: 0, checkpoints: 0, durationMs: 10 },
});

const report = (results: EvalResult[]): EvalReport => ({
  total: results.length,
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  passRate: results.filter((r) => r.ok).length / results.length,
  results,
  totals: { iterations: 1, actionsRequested: 1, actionsDenied: 0, replans: 0, durationMs: 10 },
});

test('diffReports finds regressions and improvements per case', () => {
  const base = report([res('a', true), res('b', false), res('c', true)]);
  const curr = report([res('a', false), res('b', true), res('d', true)]);
  const d = diffReports(base, curr);
  assert.deepEqual(d.regressions.map((r) => r.caseId), ['a']);
  assert.deepEqual(d.improvements.map((r) => r.caseId), ['b']);
  assert.deepEqual(d.onlyInBaseline, ['c']);
  assert.deepEqual(d.onlyInCurrent, ['d']);
  assert.equal(d.passRateDelta, 0); // both 2/3
});

test('JsonlReportStore persists history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-reg-'));
  try {
    const store = new JsonlReportStore(join(dir, 'reports.jsonl'));
    assert.equal((await store.list()).length, 0);
    await store.save(report([res('a', true)]), 'v1');
    await store.save(report([res('a', false)]), 'v2');
    const all = await store.list();
    assert.equal(all.length, 2);
    assert.equal(all[1]!.label, 'v2');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
