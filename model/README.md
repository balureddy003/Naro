# @naro/model

Provider-neutral model interface — capabilities declared, never assumed.

## What's inside

| Export | Role |
|---|---|
| `Model` | `chat()` + optional `stream`/`embed`/`rerank`, gated by `capabilities` |
| `ModelCapability` | 'chat' 'tool-calling' 'streaming' 'vision' 'embeddings' … |
| `ChatRequest`/`ChatResponse`/`ToolCall`/`Usage` | canonical message vocabulary |
| `ModelProvider` | `listModels()` + `getModel()` — one per vendor/runtime |
| `MockModel`, `textResponse` | deterministic model for tests/offline dev — `embeddings`-capable via a deterministic hashed bag-of-words, or an injected `embed` function |
| `chat()`, `stream()`, `requireCapability()` | checked call helpers |

## The rule that matters

Calling an undeclared capability throws `CapabilityNotSupportedError` —
`chat()` checks `tool-calling` when tools are offered and
`structured-output` for schema formats. Silent degradation is how agent
systems lie to themselves.

## Writing a provider

Implement `Model` (translate `ChatRequest` ↔ your wire format) and
`ModelProvider`. Credentials come from environment/config — never code.
Included adapters cover OpenAI-compatible endpoints, Anthropic Messages, and
Gemini `generateContent`. Each translates its wire format without leaking
provider types into `ChatRequest`, `ChatResponse`, or reasoning code.
