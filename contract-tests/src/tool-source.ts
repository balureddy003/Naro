import { test } from 'node:test';
import assert from 'node:assert/strict';

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
}
