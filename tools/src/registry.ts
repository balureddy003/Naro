import type { Tool } from './tool.ts';

/**
 * A source of tools — a local registry, an MCP server, a remote catalog.
 * The MCP adapter implements this interface; discovery stays async
 * because remote sources do I/O.
 */
export interface ToolSource {
  readonly id: string;
  discover(): Promise<readonly Tool[]> | readonly Tool[];
}

/**
 * The catalog of tools an agent may use.
 * Resolution is by name — names are stable identifiers, so
 * `tool://calculator` in an action survives replays and audits.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly sources: ToolSource[] = [];

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /** Track a source; call `refresh()` to (re)discover its tools. */
  addSource(source: ToolSource): this {
    this.sources.push(source);
    return this;
  }

  async refresh(): Promise<void> {
    for (const source of this.sources) {
      for (const tool of await source.discover()) this.register(tool);
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): readonly Tool[] {
    return [...this.tools.values()];
  }
}
