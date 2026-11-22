# Tool Design and MCP Governance

## Principles

1. Tools are capabilities, not free-form functions. Each tool has a schema, a risk classification, and an owner.
2. Unknown tools are denied by default.
3. Side-effecting tools require approval or strict limits.
4. MCP (or any external tool protocol) is just another source of tools; it must pass the same policy gate.

## Risk classification

| Class | Examples | Default policy |
|-------|----------|----------------|
| Read-only | list, get, search | Allow (with rate limits) |
| Reversible write | create draft, update non-critical | Allow or require approval |
| Irreversible / destructive | delete, deploy, transfer money, shell | Require approval or deny |

## MCP-specific notes

- Discovered tools still flow through the standard policy and verification pipeline.
- Trust the tool server only as far as its identity and the policy allow.
- Prefer allowlists over “connect any MCP server.”

## Naro realization

- Baseline tool policy denies unknown tools.
- Grants and capability allowlists further restrict what a run may call.
- `@naro/adapter-mcp` surfaces discovered tools as ordinary tools.

## Anti-patterns

- Letting the model invent tool calls that are not in the registry.
- Treating MCP as inherently trusted.
- No distinction between read and write tools.

See also: [Tool calling and MCP](../../learn/05-tool-calling.md).
