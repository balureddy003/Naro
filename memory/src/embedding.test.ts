import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity } from './embedding.ts';

test('identical vectors score 1', () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});

test('orthogonal vectors score 0', () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('opposite vectors score -1', () => {
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
});

test('a zero-magnitude vector scores 0, never NaN', () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});

test('mismatched lengths compare the overlapping prefix instead of throwing', () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2]), cosineSimilarity([1, 2], [1, 2]));
});
