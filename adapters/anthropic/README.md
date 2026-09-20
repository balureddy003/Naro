# @naro/adapter-anthropic

Anthropic Messages API — Claude models behind the same `Model` contract. Raw fetch, injectable, no SDK.

## Why a separate adapter

The Messages API differs enough that "OpenAI-compatible" isn't: `system` is a top-level param (not a message), tool calls are `tool_use` content blocks, tool results are `tool_result` blocks inside a *user* message, `max_tokens` is required, and `stop_reason` uses a different vocabulary. `mapping.ts` is the entire translation layer — the contract stays canonical.

## Usage

```ts
const model = new AnthropicModel('claude-sonnet-4-5', {
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultMaxTokens: 4096,
});
const react = new ReActReasoner(model);
```

## Mapped

| Capability | Wire |
|---|---|
| `chat`, `tool-calling` | `POST /v1/messages`, `tool_use`/`tool_result` blocks |
| `streaming` | SSE `content_block_delta` → `ChatChunk` |
| `vision` | image parts → `image` blocks (url source) |
| `structured-output` | not declared — Anthropic has no schema-constrained mode; use tools |

## Invariants

- Capabilities are explicit — `structured-output` is honestly absent rather than faked via prompt instructions.
- Errors surface as `NaroError` with status + body; never empty responses.
