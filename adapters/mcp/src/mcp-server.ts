import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ExecContext } from '@naro/core';
import type { ToolRegistry } from '@naro/tools';

/**
 * Serve a Naro ToolRegistry as an MCP server — the inverse of McpToolSource.
 * Any MCP host (Claude Code, Cursor, another agent) can now call Naro tools:
 * Naro isn't just an agent runtime, it's a tool provider on the standard wire.
 *
 *   const server = new McpRegistryServer(registry, ctxFactory);
 *   await server.listenStdio();   // MCP hosts spawn this process
 *
 * `ctxFactory` maps an incoming call to an ExecContext — the tool pipeline
 * still runs (schema validation, executor semantics); authorization stays
 * with whatever policy gates the caller's actions upstream.
 */
export class McpRegistryServer {
  private readonly server: Server;
  private readonly registry: ToolRegistry;
  private readonly ctx: () => ExecContext;

  constructor(
    registry: ToolRegistry,
    ctx: () => ExecContext,
    opts: { name?: string; version?: string } = {},
  ) {
    this.registry = registry;
    this.ctx = ctx;
    this.server = new Server(
      { name: opts.name ?? 'naro-tools', version: opts.version ?? '0.1.0' },
      { capabilities: { tools: {} } },
    );
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: this.registry.list().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      })),
    }));
    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const tool = this.registry.get(req.params.name);
      if (!tool) {
        return { content: [{ type: 'text', text: `unknown tool '${req.params.name}'` }], isError: true };
      }
      try {
        const output = await tool.execute(req.params.arguments, this.ctx());
        return { content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
    });
  }

  /** Exposes the raw Server for custom transports (SSE, in-memory tests). */
  get raw(): Server {
    return this.server;
  }

  /** stdio — the transport every MCP host spawns. */
  async listenStdio(): Promise<void> {
    await this.server.connect(new StdioServerTransport());
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}
