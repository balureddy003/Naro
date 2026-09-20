# @naro/adapter-openai

One adapter for OpenAI-compatible endpoints such as OpenAI, Ollama, vLLM, llama.cpp, OpenRouter, and LiteLLM gateways. Raw `fetch`—no SDK dependency.

## Usage

```ts
const provider = new OpenAiCompatibleProvider({
  baseUrl: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
  apiKey: process.env.LLM_API_KEY,
  capabilities: ['chat', 'tool-calling'],
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

- **No guessed capabilities**: the adapter defaults to `chat` only. Declare additional capabilities after verifying that the endpoint and selected model support them.
- **Errors surface**: non-2xx → `NaroError` with status + body. Never empty responses.
- **`fetch` is injectable** — tests run offline against canned wire bytes.

## Swapping providers

Any `ModelProvider` implementation is interchangeable — `OllamaProvider`, `AnthropicAdapter`, a local llama.cpp wrapper: same `chat/stream/embed` contract, same `ReActReasoner`, same runtime.
