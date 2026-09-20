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

## What MCP gives Naro / what Naro gives MCP

- **MCP gives**: a live ecosystem — filesystem, git, databases, browsers — as servers on a standard wire.
- **Naro gives MCP**: first-class treatment. Discovered tools flow through `resolve → authorize → validate → execute → observe` — same schemas, same policy gates, same event audit as local tools.

## Invariants

- MCP doesn't declare side effects, so tools default to `destructive` and require approval under `createToolPolicy`; downgrade only tools you have reviewed.
- `isError` results become thrown errors — never silent empty outputs.
- Tested in-process over `InMemoryTransport` — real protocol, no sockets needed.
