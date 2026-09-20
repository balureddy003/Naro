import { NaroError } from '@naro/core';
import type {
  ChatChunk, ChatMessage, ChatRequest, ChatResponse, Model, ModelCapability,
} from '@naro/model';
import {
  fromAnthropicStop, parseAnthropicContent, splitSystem, toAnthropicMessages, toAnthropicTools,
} from './mapping.ts';

export interface AnthropicOptions {
  /** Default 'https://api.anthropic.com'. */
  readonly baseUrl?: string;
  readonly apiKey?: string;
  /** Verified capabilities — defaults to chat + tool-calling + vision + streaming. */
  readonly capabilities?: readonly ModelCapability[];
  readonly fetchImpl?: typeof fetch;
  readonly anthropicVersion?: string;
  /** max_tokens is required by the API; callers may override per request. */
  readonly defaultMaxTokens?: number;
}

export class AnthropicModel implements Model {
  readonly id: string;
  readonly provider = 'anthropic';
  readonly capabilities: ReadonlySet<ModelCapability>;
  private readonly opts: AnthropicOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(id: string, opts: AnthropicOptions = {}) {
    this.id = id;
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.capabilities = new Set(opts.capabilities ?? ['chat', 'tool-calling', 'streaming', 'vision']);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const res = await this.fetchImpl(`${this.opts.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(request, false)),
      ...(request.signal !== undefined && { signal: request.signal }),
    });
    if (!res.ok) throw new NaroError('provider-error', `${res.status} from Anthropic: ${await res.text()}`);
    const body = await res.json() as {
      content: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
      stop_reason: string | null;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    const parsed = parseAnthropicContent(body.content as never);
    const message: ChatMessage = { role: 'assistant', content: parsed.content, ...(parsed.toolCalls && { toolCalls: parsed.toolCalls }) };
    return {
      message,
      finishReason: fromAnthropicStop(body.stop_reason),
      ...(body.usage && {
        usage: {
          inputTokens: body.usage.input_tokens,
          outputTokens: body.usage.output_tokens,
          totalTokens: (body.usage.input_tokens ?? 0) + (body.usage.output_tokens ?? 0),
        },
      }),
      ...(body.model !== undefined && { model: body.model }),
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const res = await this.fetchImpl(`${this.opts.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(request, true)),
      ...(request.signal !== undefined && { signal: request.signal }),
    });
    if (!res.ok || !res.body) throw new NaroError('provider-error', `${res.status} from Anthropic`);
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
        const ev = JSON.parse(line.slice(5).trim()) as {
          type: string;
          delta?: { type: string; text?: string };
        };
        if (ev.type === 'content_block_delta' && ev.delta?.text) {
          yield { delta: ev.delta.text, done: false };
        }
        if (ev.type === 'message_stop') { yield { delta: '', done: true }; return; }
      }
    }
    yield { delta: '', done: true };
  }

  private body(request: ChatRequest, stream: boolean) {
    const { system, rest } = splitSystem(request.messages);
    return {
      model: this.id,
      max_tokens: request.maxTokens ?? this.opts.defaultMaxTokens ?? 4096,
      messages: toAnthropicMessages(rest),
      ...(system !== undefined && { system }),
      ...(request.tools?.length && { tools: toAnthropicTools(request) }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.stop !== undefined && { stop_sequences: [...request.stop] }),
      ...(stream && { stream: true }),
    };
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'anthropic-version': this.opts.anthropicVersion ?? '2023-06-01',
      ...(this.opts.apiKey ? { 'x-api-key': this.opts.apiKey } : {}),
    };
  }
}
