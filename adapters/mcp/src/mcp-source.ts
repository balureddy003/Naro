import { createHash } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type { JsonSchema, Tool, ToolSource } from '@naro/tools';
import type { SideEffect } from '@naro/tools';

/** Order-independent JSON for hashing — object keys sorted recursively. */
function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val !== null && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val);
}

/**
 * ADR 0016: pin the definition a remote server advertised. A changed hash
 * on a later refresh() is a possible rug pull — the registry forces
 * re-approval rather than silently swapping the contract.
 */
function hashDefinition(t: McpTool): string {
  return createHash('sha256').update(stableStringify({
    name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? {},
  })).digest('hex');
}

export interface McpSourceOptions {
  /**
   * MCP doesn't declare side effects, so unknown tools default to
   * 'destructive' and require approval under Naro's baseline tool policy.
   */
  readonly defaultSideEffects?: SideEffect;
  /** Per-tool overrides: { 'delete_*': 'destructive' } */
  readonly sideEffects?: Readonly<Record<string, SideEffect>>;
}

/**
 * A ToolSource over a connected MCP client.
 *
 * MCP is the standard wire for external tool servers; Naro's contribution
 * is making its tools *first-class*: discovered tools get the same
 * Tool contract — schemas validated, permissions gated, side effects
 * declared — as anything local.
 *
 *   const client = new Client(...); await client.connect(transport);
 *   registry.addSource(new McpToolSource(client)); await registry.refresh();
 */
export class McpToolSource implements ToolSource {
  readonly id = 'mcp';
  private readonly client: Client;
  private readonly opts: McpSourceOptions;

  constructor(client: Client, opts: McpSourceOptions = {}) {
    this.client = client;
    this.opts = opts;
  }

  async discover(): Promise<readonly Tool[]> {
    const { tools } = await this.client.listTools();
    return tools.map((t) => this.toTool(t));
  }

  private toTool(t: McpTool): Tool {
    const sideEffects = this.opts.sideEffects?.[t.name]
      ?? this.opts.defaultSideEffects ?? 'destructive';
    const client = this.client;
    return {
      name: t.name,
      description: t.description ?? `MCP tool ${t.name}`,
      inputSchema: (t.inputSchema ?? { type: 'object' }) as JsonSchema,
      permissions: [],
      sideEffects,
      // A remote server's output is authored outside this system.
      trust: 'external',
      definitionHash: hashDefinition(t),
      metadata: { origin: 'mcp' },
      execute: async (input) => {
        const res = await client.callTool({
          name: t.name,
          arguments: (input ?? {}) as Record<string, unknown>,
        });
        // MCP returns content blocks; Naro tools return a single output.
        if ('structuredContent' in res && res.structuredContent !== undefined) {
          return res.structuredContent;
        }
        const parts = ('content' in res ? res.content : []) as { type: string; text?: string }[];
        const text = parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n');
        if ('isError' in res && res.isError) throw new Error(text || 'MCP tool error');
        return text;
      },
    };
  }
}
