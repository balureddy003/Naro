import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowAllPolicy, createAgentSpec, createObservation, type Goal } from '@naro/core';
import { AgentRunner, DirectReasoner } from '@naro/runtime';
import { ToolRegistry, type Tool } from '@naro/tools';
import { InMemoryPrincipalStore } from './principals.ts';
import { startAgentServer, type RunnerFactory } from './serve.ts';

const factory = (goal: Goal) => new AgentRunner({
  spec: createAgentSpec({ name: 'svc', goal }),
  reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'done' })),
  executor: { execute: (a) => Promise.resolve(createObservation({ actionId: a.id, source: a.target, kind: 'env-change', success: true })) },
  policy: allowAllPolicy,
});

const ADMIN = { 'content-type': 'application/json', authorization: 'Bearer adm' };
const admins = { adm: { id: 'boss', roles: ['admin'] as const }, view: { id: 'low', roles: ['viewer'] as const } };

test('GET /me returns the caller identity + effective roles', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0, principals: admins });
  try {
    const me = await (await fetch(`${url}/me`, { headers: { authorization: 'Bearer adm' } })).json() as { id: string; roles: string[] };
    assert.equal(me.id, 'boss');
    assert.ok(me.roles.includes('admin'));
    // A viewer sees its own limited set — the UI renders from this, not a guess.
    const low = await (await fetch(`${url}/me`, { headers: { authorization: 'Bearer view' } })).json() as { roles: string[] };
    assert.deepEqual(low.roles.sort(), ['viewer']);
  } finally {
    await close();
  }
});

test('GET /me on an unauthenticated (dev) server reports open mode', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0 });
  try {
    const me = await (await fetch(`${url}/me`)).json() as { id: string; open?: boolean };
    assert.equal(me.open, true);
  } finally {
    await close();
  }
});

test('GET /chat serves the shell without auth; chatTemplates inject into the page', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0, principals: admins,
    chatTemplates: [{ id: 'invoice-extractor', name: 'Invoice extractor', icon: 'IE', tagline: 'reads invoices' }],
  });
  try {
    const res = await fetch(`${url}/chat`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /\/chat-ui\/app\.js/);
    assert.match(body, /NARO_CHAT_CONFIG/);
    assert.match(body, /invoice-extractor/); // the manifest landed in the page
    // Its module is served from the chat-ui dist route.
    const mod = await fetch(`${url}/chat-ui/app.js`);
    assert.equal(mod.status, 200);
    assert.match(mod.headers.get('content-type') ?? '', /javascript/);
    // The filename allowlist ([a-z0-9_-]+.js) can't escape the dist dir.
    const esc = await fetch(`${url}/chat-ui/..%2F..%2Fserve.js`, { headers: { authorization: 'Bearer adm' } });
    assert.equal(esc.status, 404);
  } finally {
    await close();
  }
});

test('admin routes: 403 for non-admin, 501 when not configured', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0, principals: admins });
  try {
    const forbidden = await fetch(`${url}/admin/tool-collisions`, { headers: { authorization: 'Bearer view' } });
    assert.equal(forbidden.status, 403);
    const noRegistry = await fetch(`${url}/admin/tool-collisions`, { headers: { authorization: 'Bearer adm' } });
    assert.equal(noRegistry.status, 501);
    const noStore = await fetch(`${url}/admin/principals`, { headers: { authorization: 'Bearer adm' } });
    assert.equal(noStore.status, 501);
  } finally {
    await close();
  }
});

test('tool collisions + definition changes resolve through the admin routes', async () => {
  const registry = new ToolRegistry();
  const mk = (name: string): Tool => ({
    name, description: 'x', trust: 'tool', sideEffects: 'read',
    inputSchema: { type: 'object' as const }, permissions: [], execute: () => Promise.resolve({}),
  });
  registry.addSource({ id: 'src-a', discover: () => [mk('search')] });
  registry.addSource({ id: 'src-b', discover: () => [mk('search')] });
  await registry.refresh();

  const { url, close } = await startAgentServer(factory, { port: 0, principals: admins, toolRegistry: registry });
  try {
    const list = await (await fetch(`${url}/admin/tool-collisions`, { headers: { authorization: 'Bearer adm' } })).json() as { name: string; heldBy?: string; claimedBy: string }[];
    assert.equal(list.length, 1);
    assert.equal(list[0]!.name, 'search');
    assert.equal(list[0]!.heldBy, 'src-a');
    assert.equal(list[0]!.claimedBy, 'src-b');

    const res = await fetch(`${url}/admin/tool-collisions/resolve`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'search', sourceId: 'src-b' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { by?: string };
    assert.equal(body.by, 'boss'); // attribution rides the response
    assert.deepEqual(await (await fetch(`${url}/admin/tool-collisions`, { headers: { authorization: 'Bearer adm' } })).json(), []);

    const gone = await fetch(`${url}/admin/tool-collisions/resolve`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'search', sourceId: 'src-a' }),
    });
    assert.equal(gone.status, 404);
  } finally {
    await close();
  }
});

test('definition changes list + acknowledge via the admin routes', async () => {
  const registry = new ToolRegistry();
  let version = 1;
  const src = {
    id: 'mcp-x',
    discover: () => [{
      name: 'fetch', description: `v${version}`, trust: 'external' as const,
      sideEffects: 'read' as const, definitionHash: `h${version}`,
      inputSchema: { type: 'object' as const }, permissions: [], execute: () => Promise.resolve({}),
    }],
  };
  registry.addSource(src);
  await registry.refresh();
  version = 2;
  await registry.refresh(); // same name, new hash → pending definition change

  const { url, close } = await startAgentServer(factory, { port: 0, principals: admins, toolRegistry: registry });
  try {
    const list = await (await fetch(`${url}/admin/tool-definitions/changed`, { headers: { authorization: 'Bearer adm' } })).json() as { name: string; previous: string; current: string }[];
    assert.equal(list.length, 1);
    assert.deepEqual({ prev: list[0]!.previous, cur: list[0]!.current }, { prev: 'h1', cur: 'h2' });

    const ack = await fetch(`${url}/admin/tool-definitions/acknowledge`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'fetch', sourceId: 'mcp-x' }),
    });
    assert.equal(ack.status, 200);
    assert.deepEqual(await (await fetch(`${url}/admin/tool-definitions/changed`, { headers: { authorization: 'Bearer adm' } })).json(), []);
  } finally {
    await close();
  }
});

test('principal store: issue → auth works on next request → revoke', async () => {
  const store = new InMemoryPrincipalStore();
  // The admin bootstraps itself via the static map; the store is live.
  const { url, close } = await startAgentServer(factory, { port: 0, principals: admins, principalStore: store });
  try {
    // With a store configured, static tokens no longer authenticate —
    // the store is the identity source (ADR 0025). Seed it first.
    await store.upsert('adm', { id: 'boss', roles: new Set(['admin']) });
    const created = await fetch(`${url}/admin/principals`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ id: 'sam', roles: ['viewer', 'operator'], tenantId: 'riverside' }),
    });
    assert.equal(created.status, 201);
    const { token, id } = await created.json() as { token: string; id: string };
    assert.match(token, /^naro_/);
    assert.equal(id, 'sam');

    // The new token authenticates on the very next request — no restart.
    const me = await (await fetch(`${url}/me`, { headers: { authorization: `Bearer ${token}` } })).json() as { id: string; tenantId?: string };
    assert.equal(me.id, 'sam');
    assert.equal(me.tenantId, 'riverside');

    // list() shows last-4 only.
    const list = await (await fetch(`${url}/admin/principals`, { headers: ADMIN })).json() as { id: string; tokenLast4: string }[];
    const row = list.find((p) => p.id === 'sam')!;
    assert.equal(row.tokenLast4, token.slice(-4));

    // Revoke → the token dies on the next request.
    const del = await fetch(`${url}/admin/principals/sam`, { method: 'DELETE', headers: ADMIN });
    assert.equal(del.status, 200);
    assert.equal((await fetch(`${url}/me`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
  } finally {
    await close();
  }
});

test('POST /admin/runs/:id/prune → 501 without a prunable store', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0, principals: admins });
  try {
    const res = await fetch(`${url}/admin/runs/run_x/prune`, {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ throughSeq: 3, policy: 'GDPR' }),
    });
    assert.equal(res.status, 501);
  } finally {
    await close();
  }
});

test('goals carry specName + template through to /runs', async () => {
  let seen: { template?: string } | undefined;
  const f: RunnerFactory = (goal, info) => {
    seen = info;
    return factory(goal);
  };
  const { url, close } = await startAgentServer(f, { port: 0 });
  try {
    await fetch(`${url}/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'categorize this', template: 'transaction-categorizer' }),
    });
    assert.equal(seen?.template, 'transaction-categorizer');
    await new Promise((r) => setTimeout(r, 50));
    const runs = await (await fetch(`${url}/runs`)).json() as { specName?: string }[];
    assert.equal(runs[0]!.specName, 'svc'); // factory's spec name landed on the row
  } finally {
    await close();
  }
});
