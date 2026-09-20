import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './schema.ts';

const person = {
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const },
    age: { type: 'integer' as const },
    tags: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['name'],
  additionalProperties: false,
};

test('valid input passes', () => {
  assert.deepEqual(validate(person, { name: 'a', age: 3, tags: ['x'] }), []);
});

test('missing required property is reported with its path', () => {
  const errors = validate(person, { age: 3 });
  assert.ok(errors.some((e) => e.path === '$' && e.message.includes("'name'")));
});

test('wrong nested type is reported at the nested path', () => {
  const errors = validate(person, { name: 'a', age: 'old' });
  assert.ok(errors.some((e) => e.path === '$.age'));
});

test('extra properties fail under additionalProperties:false', () => {
  const errors = validate(person, { name: 'a', hacker: true });
  assert.ok(errors.some((e) => e.message.includes("'hacker'")));
});

test('array items are each validated', () => {
  const errors = validate(person, { name: 'a', tags: ['ok', 7] });
  assert.ok(errors.some((e) => e.path === '$.tags[1]'));
});

test('enum rejects values outside the set', () => {
  const errors = validate({ enum: ['red', 'blue'] }, 'green');
  assert.equal(errors.length, 1);
});
