import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockModel } from '@naro/model';
import { EmbeddingSource } from './embedding-source.ts';
import { ContextEngine } from './engine.ts';

const model = () => new MockModel({ capabilities: ['chat', 'embeddings'] });

test('retrieve ranks documents by semantic similarity to the query', async () => {
  const source = await EmbeddingSource.create('docs', model(), [
    { id: 'd1', text: 'the deploy pipeline fails when migrations run late' },
    { id: 'd2', text: 'cats are fluffy animals' },
    { id: 'd3', text: 'deploy checklist: run migrations first, then restart' },
  ]);
  const items = await source.retrieve({ text: 'deploy migrations checklist' });
  assert.equal(items[0]!.source, 'docs');
  assert.ok(items[0]!.score! > items.find((i) => i.id === 'd2')!.score!);
});

test('an unembeddable model is rejected up front', async () => {
  await assert.rejects(
    EmbeddingSource.create('docs', new MockModel({ capabilities: ['chat'] }), [{ text: 'x' }]),
  );
});

test('an empty document set returns no items without calling embed', async () => {
  let calls = 0;
  const m = new MockModel({
    capabilities: ['chat', 'embeddings'],
    embed: (texts) => { calls++; return texts.map(() => [1]); },
  });
  const source = await EmbeddingSource.create('docs', m, []);
  assert.deepEqual(await source.retrieve({ text: 'anything' }), []);
  assert.equal(calls, 0);
});

test('composes with ContextEngine like any other ContextSource', async () => {
  const source = await EmbeddingSource.create('docs', model(), [
    { id: 'd1', text: 'deploy runbook for the payments service' },
    { id: 'd2', text: 'lunch menu for the office' },
  ]);
  const engine = new ContextEngine({ sources: [source], budget: { maxItems: 1 } });
  const items = await engine.retrieve('deploy runbook payments');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, 'd1');
});
