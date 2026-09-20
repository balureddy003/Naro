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
