# @naro/adapter-openai

One adapter, every OpenAI-compatible endpoint: OpenAI, Ollama, vLLM, llama.cpp, OpenRouter, Azure, LiteLLM gateways. Raw `fetch` — no SDK dependency.

## Usage

```ts
const provider = new OpenAiCompatibleProvider({
  baseUrl: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
  apiKey:  process.env.LLM_API_KEY,   // env — never in code
});
const model = await provider.getModel('qwen3');
const react = new ReActReasoner(model);
```

## Capabilities mapped

| Capability | Endpoint |
|---|---|
| `chat`, `tool-calling` | `POST /chat/completions` |
| `structured-output` | `response_format: json_object` / `json_schema` |
| `streaming` | SSE, parsed chunk-by-chunk |
| `embeddings` | `POST /embeddings` |
| `vision` | image content parts → `image_url` |

## Invariants

- **No silent degradation**: capability flags are honest; a model that can't do tools still declares `tool-calling` only if the endpoint supports it — callers check `capabilities` (or supply per-model overrides).
- **Errors surface**: non-2xx → `NaroError` with status + body. Never empty responses.
- **`fetch` is injectable** — tests run offline against canned wire bytes.

## Swapping providers

Any `ModelProvider` implementation is interchangeable — `OllamaProvider`, `AnthropicAdapter`, a local llama.cpp wrapper: same `chat/stream/embed` contract, same `ReActReasoner`, same runtime.
