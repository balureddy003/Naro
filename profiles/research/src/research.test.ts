import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction } from '@naro/core';
import { ToolExecutor, ToolRegistry } from '@naro/tools';
import { ResearchEnvironment } from './research-env.ts';
import { researchTools } from './tools.ts';

const ctx = { agentId: 'a1', goalId: 'g1' };
const act = (cap: string, input?: unknown) =>
  createAction('a1', { capability: cap, target: 'env://r/x', ...(input !== undefined && { input }) });

const fakeFetch = (async () => ({
  ok: true, status: 200, text: async () => '<html>evidence page</html>',
})) as unknown as typeof fetch;

test('net.fetch returns allowlisted pages with provenance', async () => {
  const env = new ResearchEnvironment({ allowedDomains: ['example.com'], fetchImpl: fakeFetch }, 'r');
  const obs = await env.execute(act('net.fetch', { url: 'https://example.com/p' }), ctx);
  assert.equal(obs.success, true);
  assert.match((obs.output as { content: string }).content, /evidence page/);
  assert.ok((await env.state()).resources['pages']);
});

test('allowlist is enforced inside the environment', async () => {
  const env = new ResearchEnvironment({ allowedDomains: ['example.com'], fetchImpl: fakeFetch }, 'r');
  const obs = await env.execute(act('net.fetch', { url: 'https://evil.org/x' }), ctx);
  assert.equal(obs.success, false);
  assert.match(obs.error ?? '', /not in allowlist/);
  // subdomains of an allowed domain are fine
  const ok = await env.execute(act('net.fetch', { url: 'https://sub.example.com/' }), ctx);
  assert.equal(ok.success, true);
});

test('cite.add refuses unfetched URLs — cite evidence, not imagination', async () => {
  const env = new ResearchEnvironment({ allowedDomains: ['example.com'], fetchImpl: fakeFetch }, 'r');
  const bad = await env.execute(act('cite.add', { url: 'https://example.com/never', claim: 'x' }), ctx);
  assert.equal(bad.success, false);
  assert.match(bad.error ?? '', /not fetched/);
  await env.execute(act('net.fetch', { url: 'https://example.com/p' }), ctx);
  const good = await env.execute(act('cite.add', { url: 'https://example.com/p', claim: 'it says so' }), ctx);
  assert.equal(good.success, true);
  const list = await env.execute(act('cite.list'), ctx);
  assert.equal((list.output as unknown[]).length, 1);
});

test('research tools run through the standard pipeline', async () => {
  const env = new ResearchEnvironment({ allowedDomains: ['example.com'], fetchImpl: fakeFetch }, 'r');
  const reg = new ToolRegistry();
  for (const t of researchTools(env)) reg.register(t);
  const exec = new ToolExecutor(reg);
  const obs = await exec.execute(
    createAction('a1', { capability: 'tool.invoke', target: 'tool://web_fetch', input: { url: 'https://example.com/' } }),
    ctx,
  );
  assert.equal(obs.success, true);
  assert.equal(reg.get('web_fetch')?.sideEffects, 'read');
});
