import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAction, type PolicyContext } from '@naro/core';
import { InMemoryLimitStore, SqliteLimitStore } from './limiter.ts';
import { RulePolicyEngine, limitCalls } from './rules.ts';

const goal = { id: 'g', description: 't', constraints: [], successCriteria: [], priority: 1, metadata: {} };
const ctx: PolicyContext = { agentId: 'a', goal, grants: [] };
const act = (target: string) => createAction('a', { capability: 'tool.invoke', target, input: {} });

for (const [name, make] of [
  ['InMemoryLimitStore', () => new InMemoryLimitStore()],
  ['SqliteLimitStore', async () => new SqliteLimitStore(join(await mkdtemp(join(tmpdir(), 'naro-lim-')), 'l.db'))],
] as const) {
  test(`${name}: caps calls across the window`, async () => {
    const store = await make();
    const p = new RulePolicyEngine([limitCalls('tool://db', 2)], { limits: store });
    assert.equal(await p.evaluate(act('tool://db'), ctx), 'allow');
    assert.equal(await p.evaluate(act('tool://db'), ctx), 'allow');
    assert.equal(await p.evaluate(act('tool://db'), ctx), 'deny');
  });

  test(`${name}: two engines on one store share the quota`, async () => {
    const store = await make();
    const a = new RulePolicyEngine([limitCalls('tool://api', 1)], { limits: store });
    const b = new RulePolicyEngine([limitCalls('tool://api', 1)], { limits: store });
    assert.equal(await a.evaluate(act('tool://api'), ctx), 'allow');
    // A different process — same underlying quota — is already spent.
    assert.equal(await b.evaluate(act('tool://api'), ctx), 'deny');
  });

  test(`${name}: windowed limits recover`, async () => {
    const store = await make();
    const p = new RulePolicyEngine([limitCalls('tool://w', 1, 50)], { limits: store });
    assert.equal(await p.evaluate(act('tool://w'), ctx), 'allow');
    assert.equal(await p.evaluate(act('tool://w'), ctx), 'deny');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(await p.evaluate(act('tool://w'), ctx), 'allow');
  });
}
