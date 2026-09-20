import { NaroError } from '@naro/core';
import type {
  ChatChunk, ChatMessage, ChatRequest, ChatResponse, Model, ModelCapability,
} from '@naro/model';
import {
  fromGeminiFinish, fromGeminiParts, splitSystem, toGeminiContents, toGeminiTools,
} from './mapping.ts';

export interface GeminiOptions {
  /** Default 'https://generativelanguage.googleapis.com'. */
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly capabilities?: readonly ModelCapability[];
  readonly fetchImpl?: typeof fetch;
  readonly defaultMaxTokens?: number;
}

/**
 * Gemini's generateContent API behind the universal Model contract.
 * Wire differences that prove the seam: system messages hoist to
 * systemInstruction, roles are user/model (not assistant), tool calls
 * are functionCall parts with NAME-based pairing (no call ids), and
 * the key rides in the query string (AI Studio style).
 */
export class GeminiModel implements Model {
  readonly id: string;
  readonly provider = 'gemini';
  readonly capabilities: ReadonlySet<ModelCapability>;
  private readonly opts: GeminiOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(id: string, opts: GeminiOptions = {}) {
    this.id = id;
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.capabilities = new Set(opts.capabilities ?? ['chat', 'tool-calling', 'vision', 'structured-output']);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const base = this.opts.baseUrl ?? 'https://generativelanguage.googleapis.com';
    const key = this.opts.apiKey ? `?key=${this.opts.apiKey}` : '';
    const res = await this.fetchImpl(`${base}/v1beta/models/${this.id}:generateContent${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(this.body(request)),
      ...(request.signal !== undefined && { signal: request.signal }),
    });
    if (!res.ok) throw new NaroError('provider-error', `${res.status} from Gemini: ${await res.text()}`);
    const body = await res.json() as {
      candidates?: { content?: { parts?: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    };
    const cand = body.candidates?.[0];
    if (!cand) throw new NaroError('provider-error', 'Gemini returned no candidates');
    const parsed = fromGeminiParts(cand.content?.parts ?? []);
    const message: ChatMessage = {
      role: 'assistant', content: parsed.content,
      ...(parsed.toolCalls && { toolCalls: parsed.toolCalls }),
    };
    return {
      message,
      finishReason: parsed.toolCalls ? 'tool-calls' : fromGeminiFinish(cand.finishReason),
      ...(body.usageMetadata && {
        usage: {
          inputTokens: body.usageMetadata.promptTokenCount,
          outputTokens: body.usageMetadata.candidatesTokenCount,
          totalTokens: body.usageMetadata.totalTokenCount,
        },
      }),
      model: this.id,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    // Honest subset: fold a non-streamed call into a single chunk rather
    // than fake SSE parsing. Wire the streamGenerateContent endpoint when
    // needed — the contract already supports it.
    const res = await this.chat(request);
    yield {
      delta: typeof res.message.content === 'string' ? res.message.content : '',
      ...(res.message.toolCalls && { toolCalls: res.message.toolCalls }),
      done: true,
      ...(res.usage && { usage: res.usage }),
    };
  }

  private body(request: ChatRequest): Record<string, unknown> {
    const { system, rest } = splitSystem(request.messages);
    return {
      ...(system && { systemInstruction: { parts: [{ text: system }] } }),
      contents: toGeminiContents(rest),
      ...(request.tools?.length && { tools: toGeminiTools(request.tools) }),
      generationConfig: {
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        maxOutputTokens: request.maxTokens ?? this.opts.defaultMaxTokens ?? 4096,
        ...(request.stop?.length && { stopSequences: request.stop }),
        // Native structured output — no tool-forcing needed on Gemini.
        ...(request.responseFormat === 'json' && { responseMimeType: 'application/json' }),
        ...(typeof request.responseFormat === 'object' && {
          responseMimeType: 'application/json',
          responseSchema: request.responseFormat.schema,
        }),
      },
    };
  }
}
