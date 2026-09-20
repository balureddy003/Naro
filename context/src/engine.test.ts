import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContextEngine } from './engine.ts';
import { KeywordSource } from './keyword-source.ts';
import type { ContextSource } from './source.ts';

const docs = new KeywordSource('docs', [
  { id: 'd1', text: 'the deploy pipeline fails when migrations run late' },
  { id: 'd2', text: 'cats are fluffy animals' },
  { id: 'd3', text: 'deploy checklist: run migrations first, then restart' },
]);

test('retrieve fans out, ranks, and returns provenance-marked items', async () => {
  const engine = new ContextEngine({ sources: [docs] });
  const items = await engine.retrieve('deploy checklist');
  assert.ok(items.length >= 2);
  assert.equal(items[0]!.id, 'd3'); // higher overlap wins
  assert.ok(items.every((i) => i.source === 'docs'));
});

test('irrelevant documents never reach the model', async () => {
  const engine = new ContextEngine({ sources: [docs] });
  const items = await engine.retrieve('deploy');
  assert.ok(!items.some((i) => i.id === 'd2'));
});

test('item budget caps how much context is provided', async () => {
  const engine = new ContextEngine({ sources: [docs], budget: { maxItems: 1 } });
  assert.equal((await engine.retrieve('deploy migrations')).length, 1);
});

test('char budget truncates oversized content', async () => {
  const big: ContextSource = {
    id: 'big',
    retrieve: () => [{ id: 'x', source: 'big', content: 'a'.repeat(10_000), score: 1 }],
  };
  const engine = new ContextEngine({ sources: [big], budget: { maxChars: 100 } });
  const items = await engine.retrieve('anything');
  assert.ok((items[0]!.content as string).length <= 120); // cap + ellipsis marker
});

test('multiple sources merge before ranking', async () => {
  const api: ContextSource = {
    id: 'api',
    retrieve: () => [{ id: 'a1', source: 'api', content: 'deploy runbook', score: 0.99 }],
  };
  const engine = new ContextEngine({ sources: [docs, api] });
  const items = await engine.retrieve('deploy runbook');
  assert.equal(items[0]!.id, 'a1');
});
