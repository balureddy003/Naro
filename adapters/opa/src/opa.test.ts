import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, createGoal } from '@naro/core';
import { OpaPolicyEngine } from './opa.ts';

const action = createAction('a1', { capability: 'fs.write', target: 'env://ws/x', input: {} });
const ctx = { agentId: 'a1', goal: createGoal({ description: 'g' }), grants: ['fs.read'] };

function opaReturning(result: unknown): typeof fetch {
  return (async (_url: string, init: { body: string }) => ({
    ok: true, status: 200,
    json: async () => ({ result }),
    _sent: init.body,
  })) as unknown as typeof fetch;
}

test('rego decision maps to a PolicyDecision', async () => {
  const eng = new OpaPolicyEngine({ url: 'http://opa:8181', fetchImpl: opaReturning('require_approval') });
  assert.equal(await eng.evaluate(action, ctx), 'require_approval');
});

test('input document carries action + agent + goal', async () => {
  let sent = '';
  const fetchImpl = (async (_u: string, init: { body: string }) => {
    sent = init.body;
    return { ok: true, status: 200, json: async () => ({ result: 'allow' }) };
  }) as unknown as typeof fetch;
  const eng = new OpaPolicyEngine({ url: 'http://opa:8181', fetchImpl });
  await eng.evaluate(action, ctx);
  const input = (JSON.parse(sent) as { input: { action: { capability: string }; agent: { grants: string[] } } }).input;
  assert.equal(input.action.capability, 'fs.write');
  assert.deepEqual(input.agent.grants, ['fs.read']);
});

test('unreachable OPA fails closed by default', async () => {
  const eng = new OpaPolicyEngine({
    url: 'http://opa:8181',
    fetchImpl: (async () => { throw new Error('conn refused'); }) as unknown as typeof fetch,
  });
  assert.equal(await eng.evaluate(action, ctx), 'deny');
});

test('non-decision results fail closed too', async () => {
  const eng = new OpaPolicyEngine({ url: 'http://opa:8181', fetchImpl: opaReturning({ weird: true }) });
  assert.equal(await eng.evaluate(action, ctx), 'deny');
});

test('onError=allow is an explicit, documented choice', async () => {
  const eng = new OpaPolicyEngine({
    url: 'http://opa:8181', onError: 'allow',
    fetchImpl: (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch,
  });
  assert.equal(await eng.evaluate(action, ctx), 'allow');
});
