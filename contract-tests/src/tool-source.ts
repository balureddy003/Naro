import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, type Tool } from '@naro/tools';

export interface ToolLike {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  execute(input: unknown, ctx: unknown): Promise<unknown>;
}
export interface ToolSourceLike {
  readonly id: string;
  discover(): Promise<readonly ToolLike[]> | readonly ToolLike[];
}

/** Every ToolSource must yield executable, schema-described tools. */
export function toolSourceContract(name: string, make: () => ToolSourceLike | Promise<ToolSourceLike>): void {
  test(`${name}: discover() returns tools with required fields`, async () => {
    const src = await make();
    const tools = await src.discover();
    for (const t of tools) {
      assert.ok(typeof t.name === 'string' && t.name.length > 0, 'tool needs a name');
      assert.ok(typeof t.execute === 'function', `${t.name} needs execute()`);
      assert.ok(t.inputSchema !== undefined, `${t.name} needs inputSchema`);
    }
  });

  test(`${name}: tool names are unique within a source`, async () => {
    const src = await make();
    const tools = await src.discover();
    const names = tools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, `duplicate names: ${names.join(', ')}`);
  });

  // ADR 0020: a second source claiming a name this source already serves
  // must surface as a collision, never a silent overwrite.
  test(`${name}: cross-source name claims produce a collision event`, async () => {
    const src = await make();
    const tools = await src.discover();
    if (tools.length === 0) return; // nothing to collide with
    const shadow: ToolSourceLike = { id: `${src.id}-shadow`, discover: async () => tools };
    const registry = new ToolRegistry();
    for (const t of tools) registry.register(t as unknown as Tool, src.id);
    for (const t of await shadow.discover()) registry.register(t as unknown as Tool, shadow.id);
    const collisions = registry.events.filter((e) => e.type === 'tool.collision.detected');
    assert.equal(collisions.length, tools.length, 'every same-name claim from a second source must be recorded');
    assert.equal(
      registry.get(tools[0]!.name), tools[0] as unknown as Tool,
      'first-registered source stays active until resolve()',
    );
  });
}
