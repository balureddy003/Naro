import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoal, createAction } from '@naro/core';
const GOAL = createGoal({ description: 'test goal' });
import { BrowserEnvironment } from './browser-env.ts';
import type { BrowserDriver, PageState } from './driver.ts';

const ctx = { agentId: 'a1', goalId: 'g1' , goal: GOAL, grants: []};
const act = (cap: string, input?: unknown) =>
  createAction('a1', { capability: cap, target: 'env://b/x', ...(input !== undefined && { input }) });

/** Test double for the driver port — deterministic, no browser needed. */
function fakeDriver(): BrowserDriver & { calls: string[] } {
  const calls: string[] = [];
  let url = 'about:blank';
  return {
    calls,
    goto: async (u) => { calls.push(`goto:${u}`); url = u; return { url: u, title: 'Example' }; },
    click: async (s) => { calls.push(`click:${s}`); },
    type: async (s, t) => { calls.push(`type:${s}=${t}`); },
    extract: async (s) => { calls.push(`extract:${s}`); return ['a', 'b']; },
    pageState: async (): Promise<PageState> => ({ url, title: 'Example', text: 'visible text' }),
    screenshot: async () => new Uint8Array([1, 2, 3]),
    close: async () => { calls.push('close'); },
  };
}

test('goto navigates allowlisted domains', async () => {
  const driver = fakeDriver();
  const env = new BrowserEnvironment({ driver, allowedDomains: ['example.com'] }, 'b');
  const obs = await env.execute(act('browser.goto', { url: 'https://example.com/' }), ctx);
  assert.equal(obs.success, true);
  assert.equal((obs.output as { title: string }).title, 'Example');
  assert.deepEqual(driver.calls, ['goto:https://example.com/']);
});

test('navigation off the allowlist is refused by the environment', async () => {
  const env = new BrowserEnvironment({ driver: fakeDriver(), allowedDomains: ['example.com'] }, 'b');
  const obs = await env.execute(act('browser.goto', { url: 'https://tracker.evil/' }), ctx);
  assert.equal(obs.success, false);
  assert.match(obs.error ?? '', /not in allowlist/);
});

test('click/type/extract/read drive the page through the port', async () => {
  const driver = fakeDriver();
  const env = new BrowserEnvironment({ driver, allowedDomains: ['example.com'] }, 'b');
  await env.execute(act('browser.goto', { url: 'https://example.com/' }), ctx);
  assert.equal((await env.execute(act('browser.click', { selector: '#go' }), ctx)).success, true);
  assert.equal((await env.execute(act('browser.type', { selector: '#q', text: 'naro' }), ctx)).success, true);
  const ex = await env.execute(act('browser.extract', { selector: 'li' }), ctx);
  assert.deepEqual(ex.output, ['a', 'b']);
  const read = await env.execute(act('browser.read'), ctx);
  assert.equal((read.output as PageState).text, 'visible text');
});

test('state() exposes the current page as observable resources', async () => {
  const env = new BrowserEnvironment({ driver: fakeDriver(), allowedDomains: [] }, 'b');
  const s = await env.state();
  assert.equal((s.resources['page'] as { url: string }).url, 'about:blank');
});
