# @naro/model

Provider-neutral model interface — capabilities declared, never assumed.

## What's inside

| Export | Role |
|---|---|
| `Model` | `chat()` + optional `stream`/`embed`/`rerank`, gated by `capabilities` |
| `ModelCapability` | 'chat' 'tool-calling' 'streaming' 'vision' 'embeddings' … |
| `ChatRequest`/`ChatResponse`/`ToolCall`/`Usage` | canonical message vocabulary |
| `ModelProvider` | `listModels()` + `getModel()` — one per vendor/runtime |
| `MockModel`, `textResponse` | deterministic model for tests/offline dev |
| `chat()`, `stream()`, `requireCapability()` | checked call helpers |

## The rule that matters

Calling an undeclared capability throws `CapabilityNotSupportedError` —
`chat()` checks `tool-calling` when tools are offered and
`structured-output` for schema formats. Silent degradation is how agent
systems lie to themselves.

## Writing a provider

Implement `Model` (translate `ChatRequest` ↔ your wire format) and
`ModelProvider`. Credentials come from environment/config — never code.
An OpenAI-compatible adapter covers Ollama, vLLM, llama.cpp, and most
hosted endpoints with one implementation.
