import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NaroEvent } from '@naro/core';
import { redact, redacting } from './redact.ts';
import type { EventExporter } from './exporter.ts';

test('redact masks sensitive keys at any depth', () => {
  const out = redact({
    config: { apiKey: 'real-key', nested: { password: 'hunter2' } },
    safe: 'value',
  }) as { config: { apiKey: string; nested: { password: string } }; safe: string };
  assert.equal(out.config.apiKey, '[REDACTED]');
  assert.equal(out.config.nested.password, '[REDACTED]');
  assert.equal(out.safe, 'value');
});

test('redact masks secret-shaped strings', () => {
  const out = redact({ auth: 'ok', msg: 'use Bearer abc.def.ghi and sk-1234567890ab' }) as { msg: string };
  assert.equal(out.msg, 'use [REDACTED] and [REDACTED]');
});

test('redacting() wraps an exporter — internal stream stays complete', async () => {
  const exported: NaroEvent[] = [];
  const inner: EventExporter = { export: (evs) => { exported.push(...evs); } };
  const exp = redacting(inner);
  const ev = {
    id: 'e1', type: 'action.requested', seq: 1, at: 0, agentId: 'a', goalId: 'g',
    data: { action: { input: { token: 't0ken', note: 'hi' } } },
  } as unknown as NaroEvent;
  await exp.export([ev]);
  const sent = exported[0]!.data as { action: { input: { token: string; note: string } } };
  assert.equal(sent.action.input.token, '[REDACTED]');
  assert.equal(sent.action.input.note, 'hi');
  // original event object is untouched — the bus copy stays complete
  assert.equal((ev.data as { action: { input: { token: string } } }).action.input.token, 't0ken');
});
