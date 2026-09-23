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

## Ollama — the self-hosted cheap tier (PRD-005)

Ollama serves the same OpenAI-compatible transport on `http://localhost:11434/v1`.
This package ships the two pieces PRD-005 needs — no separate adapter:

```ts
import { ollamaCheapTier, verifyOllamaCapabilities } from '@naro/adapter-openai';

// 1. Verify once per pulled model — capabilities come from real
//    round-trips, not the catalog's marketing claims.
const verified = await verifyOllamaCapabilities({ model: 'qwen2.5:3b' });
//    → { reachable: true, probes: {chat, toolCalling, …},
//         capabilities: ['chat','tool-calling','structured-output',…] }

// 2. One line: a ready EscalatingReasoner cheap tier.
const cheap = ollamaCheapTier({ model: 'qwen2.5:3b', capabilities: verified.capabilities });
new EscalatingReasoner({ tiers: [cheap.reasoner, strongReasoner] });
```

Rules, per the PRD:

- **Declared capabilities are evidence, not config.** An unverified model
  gets `['chat']` — which means a cheap tier can't answer ReAct tool calls
  until its probe passes. Run `verifyOllamaCapabilities` after
  `ollama pull`, keep the result.
- **Unreachable is loud, not silent.** `reachable: false` reports the
  failure reason; at runtime the adapter throws `NaroError` on a dead
  endpoint, so an `EscalatingReasoner` failure reads "Ollama was down,"
  not an unexplained cost spike on the strong tier.
- **Hardware reality:** these are 1B–7B models — usable on commodity
  CPU/GPU, roughly 5–40 tok/s depending on hardware. Verify latency
  against your hardware before committing a template to the tier.
- **Candidate list:** `OLLAMA_CANDIDATES` carries size/license facts;
  the verified column is yours to fill in — `NARO_OLLAMA=1 npm test` runs
  the live probe suite against a local `ollama serve`.

## Swapping providers

Any `ModelProvider` implementation is interchangeable — `OllamaProvider`, `AnthropicAdapter`, a local llama.cpp wrapper: same `chat/stream/embed` contract, same `ReActReasoner`, same runtime.
