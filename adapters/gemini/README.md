# @naro/adapter-gemini

Google Gemini `generateContent` behind Naro's provider-neutral `Model` contract.
The adapter uses raw injectable `fetch` and has no provider SDK dependency.

## Usage

```ts
const model = new GeminiModel('gemini-2.0-flash', {
  apiKey: process.env.GEMINI_API_KEY,
  defaultMaxTokens: 4096,
});
```

For production, resolve credentials through deployment configuration or a
secret provider rather than placing values in actions, prompts, or source.

## Mapping

| Naro | Gemini wire format |
|---|---|
| system message | `systemInstruction` |
| user/assistant messages | `contents` with `user`/`model` roles |
| tools | function declarations and `functionCall` parts |
| JSON response | `responseMimeType: application/json` |
| schema response | `responseSchema` |
| usage | `usageMetadata` token fields |

Gemini pairs function results by function name because its wire format does not
use OpenAI-style call IDs. The adapter translates that difference without
changing Naro's model contract.

## Capabilities and streaming

The default declared capabilities are `chat`, `tool-calling`, `vision`, and
`structured-output`. Override them when the selected model supports less.

The current `stream()` implementation is an honest compatibility subset: it
performs one non-streaming `generateContent` request and emits a single final
`ChatChunk`. It does not call Gemini's streaming endpoint or provide token-by-
token progress.

## Embeddings

`embed(texts)` calls `batchEmbedContents` and requires `'embeddings'` in the
declared capabilities. Construct a separate `GeminiModel` for it — Gemini has
no single model that both chats and embeds:

```ts
const embedder = new GeminiModel('gemini-embedding-001', {
  apiKey: process.env.GEMINI_API_KEY,
  capabilities: ['embeddings'],
});
const [vector] = await embedder.embed(['hello world']);
```

## Failure behavior

- non-2xx responses become `NaroError`;
- a response without candidates (or, for `embed`, without embeddings) fails
  instead of becoming an empty answer;
- `fetchImpl` is injectable for offline tests.
