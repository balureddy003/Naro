import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, type Tool, type ToolSource } from './index.ts';

function tool(name: string, extra: Partial<Tool> = {}): Tool {
  return {
    name, description: `does ${name}`, inputSchema: { type: 'object' },
    permissions: [], sideEffects: 'read',
    execute: () => Promise.resolve('ok'),
    ...extra,
  };
}

function source(id: string, tools: readonly Tool[]): ToolSource {
  return { id, discover: async () => tools };
}

// ── ADR 0016: definition pinning ──────────────────────────────────────

test('registry: a changed definitionHash forces destructive until acknowledged', async () => {
  const reg2 = new ToolRegistry();
  reg2.addSource(source('mcp-a', [tool('search', { definitionHash: 'h1' })]));
  await reg2.refresh();
  assert.equal(reg2.get('search')!.sideEffects, 'read');

  // Same source, new definition on the next refresh — the rug pull.
  reg2.register(tool('search', { definitionHash: 'h2' }), 'mcp-a');

  const changed = reg2.events.filter((e) => e.type === 'tool.definition.changed');
  assert.equal(changed.length, 1);
  assert.equal(changed[0]!.data['previous'], 'h1');
  assert.equal(changed[0]!.data['current'], 'h2');
  // Forced destructive — baseline policy re-approves before the model can use it casually.
  assert.equal(reg2.get('search')!.sideEffects, 'destructive');
  assert.equal(reg2.get('search')!.metadata?.['definitionChanged'], true);

  assert.equal(reg2.acknowledgeDefinition('search'), true);
  assert.equal(reg2.get('search')!.sideEffects, 'read');
});

test('registry: an unchanged definitionHash registers silently', async () => {
  const registry = new ToolRegistry();
  registry.addSource(source('mcp-a', [tool('search', { definitionHash: 'h1' })]));
  await registry.refresh();
  registry.register(tool('search', { definitionHash: 'h1' }), 'mcp-a');
  assert.equal(registry.events.length, 0);
  assert.equal(registry.get('search')!.sideEffects, 'read');
});

test('registry: acknowledgeDefinition returns false when nothing is pending', () => {
  const registry = new ToolRegistry();
  assert.equal(registry.acknowledgeDefinition('nope'), false);
});

// ── ADR 0020: cross-source collisions ─────────────────────────────────

test('registry: a second source claiming a name is held, not swapped in', async () => {
  const registry = new ToolRegistry();
  const a = tool('search', { description: 'trusted search' });
  const b = tool('search', { description: 'shadowing search' });
  registry.addSource(source('mcp-a', [a]));
  registry.addSource(source('mcp-b', [b]));
  await registry.refresh();

  assert.equal(registry.get('search')!.description, 'trusted search');
  const collisions = registry.events.filter((e) => e.type === 'tool.collision.detected');
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]!.data['heldBy'], 'mcp-a');
  assert.equal(collisions[0]!.data['claimedBy'], 'mcp-b');
  assert.deepEqual(registry.collisions(), [{ name: 'search', heldBy: 'mcp-a', claimedBy: 'mcp-b' }]);
});

test('registry: resolve() promotes the shadowed source', async () => {
  const registry = new ToolRegistry();
  registry.register(tool('search', { description: 'first' }), 'a');
  registry.register(tool('search', { description: 'second' }), 'b');
  assert.equal(registry.get('search')!.description, 'first');

  assert.equal(registry.resolve('search', 'b'), true);
  assert.equal(registry.get('search')!.description, 'second');
  assert.equal(registry.collisions().length, 0);
  assert.equal(registry.resolve('search', 'b'), false); // nothing left to resolve
});

test('registry: a sourced tool cannot silently shadow a local one', () => {
  const registry = new ToolRegistry();
  registry.register(tool('fs.write')); // hand-registered local, no sourceId
  registry.register(tool('fs.write', { description: 'evil twin' }), 'mcp-x');
  assert.equal(registry.get('fs.write')!.description, 'does fs.write');
  assert.equal(registry.events[0]!.type, 'tool.collision.detected');
  assert.equal(registry.events[0]!.data['heldBy'], 'local');
});

test('registry: sourceless register() keeps original overwrite behavior', () => {
  const registry = new ToolRegistry();
  registry.register(tool('x', { description: 'v1' }));
  registry.register(tool('x', { description: 'v2' }));
  assert.equal(registry.get('x')!.description, 'v2');
  assert.equal(registry.events.length, 0);
});

test('registry: onEvent forwards registry events for journaling', async () => {
  const seen: string[] = [];
  const registry = new ToolRegistry({ onEvent: (e) => seen.push(e.type) });
  registry.register(tool('x'), 'a');
  registry.register(tool('x'), 'b');
  assert.deepEqual(seen, ['tool.collision.detected']);
});
