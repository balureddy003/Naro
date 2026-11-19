import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ExecContext } from '@naro/core';
import type { ToolRegistry } from '@naro/tools';
import type { HarnessKernel } from '@naro/adapter-harness';

/**
 * Serve a Naro ToolRegistry as an MCP server — the inverse of McpToolSource.
 * Any MCP host (Claude Code, Cursor, another agent) can call Naro tools:
 * Naro isn't just an agent runtime, it's a tool provider on the standard wire.
 *
 *   const kernel = harnessKernel({ agentId: 'mcp-server', goal, policy });
 *   const server = new McpRegistryServer(registry, ctxFactory, { kernel });
 *   await server.listenStdio();   // MCP hosts spawn this process
 *
 * ADR 0015: inbound calls are governed, not trusted. Every `tools/call`
 * routes through the HarnessKernel — the same policy gate + hash-chained
 * journal a foreign harness gets (ADR 0009) — so `naro verify` covers MCP
 * traffic identically to in-kernel actions. `ctxFactory` still maps each
 * call to an ExecContext for the executor, but authorization no longer
 * depends on the caller: the gate runs first, always.
 *
 * MCP has no approval prompt, so a `require_approval` verdict degrades to a
 * closed-out error — surfaced in the response text, journaled as
 * `human.approval.requested` plus a failed observation (same degradation
 * ADR 0009 documented for hookless harnesses).
 */
export class McpRegistryServer {
  private readonly server: Server;
  private readonly registry: ToolRegistry;
  private readonly ctx: () => ExecContext;
  private readonly kernel: HarnessKernel;
  /** Calls serialize so the kernel's pending FIFO joins each result to its own gate verdict. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    registry: ToolRegistry,
    ctx: () => ExecContext,
    opts: { name?: string; version?: string; kernel: HarnessKernel },
  ) {
    this.registry = registry;
    this.ctx = ctx;
    this.kernel = opts.kernel;
    this.kernel.startSession();
    this.server = new Server(
      { name: opts.name ?? 'naro-tools', version: opts.version ?? '0.1.0' },
      { capabilities: { tools: {} } },
    );
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      // Listing metadata is not an action — no gate (ADR 0015).
      tools: this.registry.list().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      })),
    }));
    this.server.setRequestHandler(CallToolRequestSchema, (req) => this.enqueue(() => this.call(req.params)));
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  private async call(params: { name: string; arguments?: Record<string, unknown> }) {
    const tool = this.registry.get(params.name);
    if (!tool) {
      return { content: [{ type: 'text' as const, text: `unknown tool '${params.name}'` }], isError: true };
    }

    const call = { toolName: params.name, input: params.arguments };
    const verdict = await this.kernel.gateTool(call);
    if (verdict.decision === 'deny') {
      // gateTool already journaled action.denied + the error observation.
      return { content: [{ type: 'text' as const, text: verdict.reason ?? 'denied by policy' }], isError: true };
    }
    if (verdict.decision === 'ask') {
      // No approval channel over MCP — close out the pending action so the
      // journal records "needed approval, never ran" rather than leaking it.
      const reason = `requires approval — no approval path over MCP (${verdict.reason ?? 'policy'})`;
      this.kernel.observeTool(call, { error: reason });
      return { content: [{ type: 'text' as const, text: reason }], isError: true };
    }

    try {
      const output = await tool.execute(params.arguments, this.ctx());
      this.kernel.observeTool(call, { output });
      return { content: [{ type: 'text' as const, text: typeof output === 'string' ? output : JSON.stringify(output) }] };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.kernel.observeTool(call, { error });
      return { content: [{ type: 'text' as const, text: error }], isError: true };
    }
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
    await this.chain; // let any in-flight gated call land its journal events
    await this.kernel.endSession({ result: 'session closed' });
    await this.server.close();
  }
}
