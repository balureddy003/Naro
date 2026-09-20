import { NaroError } from '@naro/core';
import type {
  ChatChunk, ChatMessage, ChatRequest, ChatResponse, Model, ModelCapability,
} from '@naro/model';
import { fromOaiFinish, fromOaiToolCalls, toOaiMessages, toOaiResponseFormat, toOaiTools } from './mapping.ts';

export interface OpenAiCompatOptions {
  /** e.g. 'https://api.openai.com/v1', 'http://localhost:11434/v1' (Ollama), vLLM's :8000/v1. */
  readonly baseUrl: string;
  /** Injected by the provider — never hard-coded in agent code. */
  readonly apiKey?: string;
  /** Injectable for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * A Model over any OpenAI-compatible HTTP API. One adapter covers
 * OpenAI, Ollama, vLLM, llama.cpp, OpenRouter, Azure — the endpoint is
 * config, the contract is code.
 */
export class OpenAiCompatibleModel implements Model {
  readonly id: string;
  readonly provider: string;
  readonly capabilities: ReadonlySet<ModelCapability>;
  private readonly opts: OpenAiCompatOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(id: string, opts: OpenAiCompatOptions, provider = 'openai-compatible') {
    this.id = id;
    this.provider = provider;
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.capabilities = new Set<ModelCapability>([
      'chat', 'tool-calling', 'streaming', 'structured-output', 'embeddings', 'vision',
    ]);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.requestBody(request, false)),
      ...(request.signal !== undefined && { signal: request.signal }),
    });
    if (!res.ok) throw new NaroError('provider-error', `${res.status} from ${this.opts.baseUrl}: ${await res.text()}`);
    const body = await res.json() as {
      choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
    };
    const choice = body.choices[0];
    const message: ChatMessage = {
      role: 'assistant',
      content: choice?.message.content ?? '',
      ...(choice?.message.tool_calls && { toolCalls: fromOaiToolCalls(choice.message.tool_calls) }),
    };
    return {
      message,
      finishReason: fromOaiFinish(choice?.finish_reason),
      ...(body.usage && {
        usage: {
          inputTokens: body.usage.prompt_tokens,
          outputTokens: body.usage.completion_tokens,
          totalTokens: body.usage.total_tokens,
        },
      }),
      ...(body.model !== undefined && { model: body.model }),
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.requestBody(request, true)),
      ...(request.signal !== undefined && { signal: request.signal }),
    });
    if (!res.ok || !res.body) throw new NaroError('provider-error', `${res.status} from ${this.opts.baseUrl}`);

    // SSE: lines "data: {json}" until "data: [DONE]"
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { yield { delta: '', done: true }; return; }
        const chunk = JSON.parse(data) as {
          choices: { delta: { content?: string }; finish_reason?: string | null }[];
        };
        const c = chunk.choices[0];
        if (c?.finish_reason) { yield { delta: '', done: true }; return; }
        if (c?.delta?.content) yield { delta: c.delta.content, done: false };
      }
    }
    yield { delta: '', done: true };
  }

  async embed(texts: readonly string[]): Promise<readonly number[][]> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.id, input: texts }),
    });
    if (!res.ok) throw new NaroError('provider-error', `${res.status} from ${this.opts.baseUrl}`);
    const body = await res.json() as { data: { embedding: number[] }[] };
    return body.data.map((d) => d.embedding);
  }

  private requestBody(request: ChatRequest, stream: boolean) {
    return {
      model: this.id,
      messages: toOaiMessages(request.messages),
      ...(request.tools?.length && { tools: toOaiTools(request), tool_choice: 'auto' }),
      ...(request.responseFormat && { response_format: toOaiResponseFormat(request) }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.maxTokens !== undefined && { max_tokens: request.maxTokens }),
      ...(request.stop !== undefined && { stop: [...request.stop] }),
      ...(stream && { stream: true }),
    };
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
    };
  }
}
