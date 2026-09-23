---
"@naro/adapter-mcp": minor
---

`McpRegistryServer` now routes every inbound `tools/call` through a
required `HarnessKernel` (ADR 0015): the serving direction of MCP gets the
same policy gate + hash-chained journal every other adapter surface has —
`action.requested → permission.requested → permitted|denied` plus
`action.completed`/`observation.created` land in the kernel's journal, so
`naro verify`/`buildEvidence` cover MCP traffic.

Breaking change: the constructor signature gains a required `kernel`
option. MCP has no approval channel, so `require_approval` verdicts
degrade to a closed-out error — journaled, not silent.
