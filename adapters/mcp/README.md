# @naro/adapter-mcp

MCP (Model Context Protocol) `ToolSource` — discover and invoke tools on any MCP server through the standard Naro pipeline.

## Usage

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'naro', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: 'npx', args: ['-y', 'some-mcp-server'] }));

registry.addSource(new McpToolSource(client, {
  sideEffects: { search: 'read' },
}));
await registry.refresh();
```

## Serving Naro tools over MCP

`McpRegistryServer` exposes a `ToolRegistry` on the standard wire, so any
MCP host (Claude Code, Cursor, another agent) can call Naro tools.
Per ADR 0015, inbound calls are *governed*: every `tools/call` routes
through a `HarnessKernel` — the same policy gate + hash-chained journal a
foreign harness gets — so a denial is journaled evidence and `naro verify`
covers MCP traffic identically to in-kernel actions.

```ts
import { harnessKernel } from '@naro/adapter-harness';

const kernel = harnessKernel({ agentId: 'mcp-server', goal: 'serve Naro tools', policy });
const server = new McpRegistryServer(registry, () => execContext, { kernel });
await server.listenStdio();
```

MCP has no approval prompt: a `require_approval` verdict degrades to a
closed-out error (journaled as `human.approval.requested` + a failed
observation), matching the hookless-harness degradation in ADR 0009.

## What MCP gives Naro / what Naro gives MCP

- **MCP gives**: a live ecosystem — filesystem, git, databases, browsers — as servers on a standard wire.
- **Naro gives MCP**: first-class treatment in *both* directions — discovered tools flow through `resolve → authorize → validate → execute → observe` when Naro is the caller, and served tools pass the same `HarnessKernel` gate when Naro is the callee.

## Invariants

- MCP doesn't declare side effects, so tools default to `destructive` and require approval under `createToolPolicy`; downgrade only tools you have reviewed.
- `isError` results become thrown errors — never silent empty outputs.
- `McpRegistryServer` requires a `HarnessKernel` — there is no ungated serving mode.
- Tested in-process over `InMemoryTransport` — real protocol, no sockets needed.
