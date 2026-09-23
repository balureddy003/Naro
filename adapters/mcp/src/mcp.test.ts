import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolExecutor, ToolRegistry } from '@naro/tools';
import { createGoal, createAction } from '@naro/core';
const GOAL = createGoal({ description: 'test goal' });
import { McpToolSource } from './mcp-source.ts';

/** In-process MCP server exposing one 'echo' tool — real protocol, no sockets. */
async function makeServer() {
  const server = new Server({ name: 'test-server', version: '0.0.1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'echo',
      description: 'echoes input',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => ({
    content: [{ type: 'text', text: `echo:${(req.params.arguments as { text: string }).text}` }],
  }));
  return server;
}

async function connectedPair() {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'naro-test', version: '0.0.1' });
  const server = await makeServer();
  await Promise.all([client.connect(ct), server.connect(st)]);
  return client;
}

test('MCP tools are discovered through the ToolSource seam', async () => {
  const client = await connectedPair();
  const registry = new ToolRegistry();
  registry.addSource(new McpToolSource(client));
  await registry.refresh();

  const tool = registry.get('echo');
  assert.ok(tool, 'echo should be registered');
  assert.equal(tool.metadata?.['origin'], 'mcp');
  assert.equal(tool.sideEffects, 'destructive'); // unknown remote tools require approval
});

test('discovered MCP tools execute through the standard pipeline', async () => {
  const client = await connectedPair();
  const registry = new ToolRegistry();
  registry.addSource(new McpToolSource(client));
  await registry.refresh();

  const executor = new ToolExecutor(registry);
  const obs = await executor.execute(
    createAction('a1', { capability: 'tool.invoke', target: 'tool://echo', input: { text: 'hi' } }),
    { agentId: 'a1', goalId: 'g1' , goal: GOAL, grants: []},
  );
  assert.equal(obs.success, true);
  assert.equal(obs.output, 'echo:hi');
});

test('schema validation still applies to MCP tools', async () => {
  const client = await connectedPair();
  const registry = new ToolRegistry();
  registry.addSource(new McpToolSource(client));
  await registry.refresh();
  const obs = await new ToolExecutor(registry).execute(
    createAction('a1', { capability: 'tool.invoke', target: 'tool://echo', input: {} }),
    { agentId: 'a1', goalId: 'g1' , goal: GOAL, grants: []},
  );
  assert.equal(obs.success, false);
  assert.match(obs.error ?? '', /invalid input/);
});

// ── Contract suite: McpToolSource is a ToolSource like any other ─────
import { toolSourceContract } from '@naro/contract-tests';
toolSourceContract('McpToolSource', async () => new McpToolSource(await connectedPair()));

test('McpRegistryServer: Naro tools callable over the MCP wire — governed (ADR 0015)', async () => {
  const { McpRegistryServer } = await import('./mcp-server.ts');
  const { harnessKernel } = await import('@naro/adapter-harness');
  const { allowAllPolicy } = await import('@naro/core');
  const registry = new ToolRegistry();
  registry.register({
    name: 'upper', description: 'uppercase', inputSchema: { type: 'object' },
    permissions: [], sideEffects: 'none',
    execute: (input) => Promise.resolve(String((input as { s?: string }).s ?? '').toUpperCase()),
  });
  const kernel = harnessKernel({ agentId: 'mcp-server', goal: GOAL, policy: allowAllPolicy });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'host', version: '0.0.1' });
  const server = new McpRegistryServer(registry, () => ({ agentId: 'a', goalId: 'g', goal: GOAL, grants: [] }), { kernel });
  await Promise.all([client.connect(ct), server.raw.connect(st)]);
  try {
    const list = await client.listTools();
    assert.deepEqual(list.tools.map((t) => t.name), ['upper']);
    const res = await client.callTool({ name: 'upper', arguments: { s: 'hello' } });
    assert.deepEqual((res as { content: { text: string }[] }).content[0]!.text, 'HELLO');
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
  // The gate ran: request → permitted → executed → observed, all journaled.
  const types = kernel.journal().map((e) => e.type);
  assert.ok(types.includes('action.requested'));
  assert.ok(types.includes('permission.requested'));
  assert.ok(types.includes('action.permitted'));
  assert.ok(types.includes('action.completed'));
  assert.ok(types.includes('observation.created'));
});

test('McpRegistryServer: a policy deny never reaches execute (ADR 0015)', async () => {
  const { McpRegistryServer } = await import('./mcp-server.ts');
  const { harnessKernel } = await import('@naro/adapter-harness');
  let ran = false;
  const registry = new ToolRegistry();
  registry.register({
    name: 'nuke', description: 'dangerous', inputSchema: { type: 'object' },
    permissions: [], sideEffects: 'destructive',
    execute: () => { ran = true; return Promise.resolve('done'); },
  });
  const kernel = harnessKernel({
    agentId: 'mcp-server', goal: GOAL,
    policy: { id: 'test-deny', evaluate: () => ({ decision: 'deny', reason: 'not allowed here' }) },
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'host', version: '0.0.1' });
  const server = new McpRegistryServer(registry, () => ({ agentId: 'a', goalId: 'g', goal: GOAL, grants: [] }), { kernel });
  await Promise.all([client.connect(ct), server.raw.connect(st)]);
  try {
    const res = await client.callTool({ name: 'nuke', arguments: {} });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match((res as { content: { text: string }[] }).content[0]!.text, /not allowed here/);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
  assert.equal(ran, false);
  const denied = kernel.journal().find((e) => e.type === 'action.denied');
  assert.ok(denied, 'denial must be journaled — the verdict is evidence even though the tool never ran');
});

test('McpRegistryServer: require_approval degrades to a closed-out error (no approval path over MCP)', async () => {
  const { McpRegistryServer } = await import('./mcp-server.ts');
  const { harnessKernel } = await import('@naro/adapter-harness');
  let ran = false;
  const registry = new ToolRegistry();
  registry.register({
    name: 'needs-ok', description: 'approval-gated', inputSchema: { type: 'object' },
    permissions: [], sideEffects: 'write',
    execute: () => { ran = true; return Promise.resolve('done'); },
  });
  const kernel = harnessKernel({
    agentId: 'mcp-server', goal: GOAL,
    policy: { id: 'test-ask', evaluate: () => 'require_approval' },
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'host', version: '0.0.1' });
  const server = new McpRegistryServer(registry, () => ({ agentId: 'a', goalId: 'g', goal: GOAL, grants: [] }), { kernel });
  await Promise.all([client.connect(ct), server.raw.connect(st)]);
  try {
    const res = await client.callTool({ name: 'needs-ok', arguments: {} });
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match((res as { content: { text: string }[] }).content[0]!.text, /requires approval/);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
  assert.equal(ran, false);
  const types = kernel.journal().map((e) => e.type);
  assert.ok(types.includes('human.approval.requested'), 'the approval need is journaled even though no one could answer it');
});
