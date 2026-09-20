# @naro/adapter-gemini

Google Gemini (`generateContent`) behind the `@naro/model` seam —
the third wire format (after OpenAI and Anthropic), proving the
contract isn't provider-shaped.

```ts
import { GeminiModel } from '@naro/adapter-gemini';

const model = new GeminiModel({
  apiKey: process.env.GEMINI_API_KEY!,   // or resolve via ctx.secrets
  model: 'gemini-2.0-flash',
});
```

Maps Naro's neutral transcript onto Gemini's `contents`/`parts`/
`functionCall` shapes; tool-call ids are preserved so results pair
correctly on the next turn.
