import type { Model } from './model.ts';
import type { ModelCapability } from './capabilities.ts';
import type { ChatChunk, ChatRequest, ChatResponse } from './messages.ts';

export type MockResponder = (request: ChatRequest) => ChatResponse | Promise<ChatResponse>;
export type MockEmbedder = (texts: readonly string[]) => readonly (readonly number[])[] | Promise<readonly (readonly number[])[]>;

const EMBED_DIMS = 32;

/**
 * Deterministic hashed bag-of-words — not a real embedding model, but
 * shared vocabulary buckets together so semantically related mock texts
 * score more similar than unrelated ones. That's enough to exercise
 * ranking logic offline without an API key.
 */
function defaultEmbed(texts: readonly string[]): readonly (readonly number[])[] {
  return texts.map((text) => {
    const vec = new Array<number>(EMBED_DIMS).fill(0);
    for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      let h = 0;
      for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
      const bucket = h % EMBED_DIMS;
      vec[bucket] = (vec[bucket] ?? 0) + 1;
    }
    return vec;
  });
}

/**
 * A deterministic model for tests, examples, and offline development.
 *
 * Two modes: a `respond` function (inspect the request, craft the reply)
 * or a queue of canned `responses` popped one per call. This is how all
 * of Naro runs with zero API keys — the core never needs a real LLM.
 */
export class MockModel implements Model {
  readonly id: string;
  readonly provider = 'naro-mock';
  readonly capabilities: ReadonlySet<ModelCapability>;
  private readonly responder?: MockResponder;
  private readonly queue: ChatResponse[];
  private readonly embedder: MockEmbedder;

  constructor(options: {
    id?: string;
    capabilities?: readonly ModelCapability[];
    respond?: MockResponder;
    responses?: readonly ChatResponse[];
    /** Defaults to a deterministic hashed bag-of-words — see `defaultEmbed`. */
    embed?: MockEmbedder;
  } = {}) {
    this.id = options.id ?? 'mock-model';
    this.capabilities = new Set(options.capabilities ?? ['chat', 'tool-calling', 'streaming']);
    this.responder = options.respond;
    this.queue = [...(options.responses ?? [])];
    this.embedder = options.embed ?? defaultEmbed;
  }

  /** Requires 'embeddings' declared in `capabilities` — same gating discipline as any adapter. */
  async embed(texts: readonly string[]): Promise<readonly number[][]> {
    return (await this.embedder(texts)).map((v) => [...v]);
  }

  chat(request: ChatRequest): Promise<ChatResponse> {
    if (this.responder) return Promise.resolve(this.responder(request));
    const next = this.queue.shift();
    if (!next) {
      return Promise.resolve({
        message: { role: 'assistant', content: 'mock: no scripted response left' },
        finishReason: 'stop',
        model: this.id,
      });
    }
    return Promise.resolve(next);
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const res = await this.chat(request);
    const text = typeof res.message.content === 'string' ? res.message.content : '';
    // Yield word-ish pieces so streaming code paths get exercised.
    for (const word of text.split(/(\s+)/)) {
      yield { delta: word, done: false };
    }
    yield { delta: '', toolCalls: res.message.toolCalls, done: true, ...(res.usage !== undefined && { usage: res.usage }) };
  }
}

/** Convenience: build a plain-text ChatResponse. */
export function textResponse(content: string, extra?: Partial<ChatResponse>): ChatResponse {
  return { message: { role: 'assistant', content }, finishReason: 'stop', ...extra };
}
