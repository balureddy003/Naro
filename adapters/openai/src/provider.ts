import type { Model, ModelInfo, ModelProvider } from '@naro/model';
import { OpenAiCompatibleModel, type OpenAiCompatOptions } from './model.ts';

/**
 * ModelProvider over an OpenAI-compatible endpoint.
 *
 *   new OpenAiCompatibleProvider({
 *     baseUrl: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
 *     apiKey:  process.env.LLM_API_KEY,          // env, never code
 *   })
 */
export class OpenAiCompatibleProvider implements ModelProvider {
  readonly id: string;
  private readonly opts: OpenAiCompatOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAiCompatOptions & { id?: string }) {
    this.id = opts.id ?? 'openai-compatible';
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  getModel(id: string): Promise<Model> {
    return Promise.resolve(new OpenAiCompatibleModel(id, this.opts, this.id));
  }

  async listModels(): Promise<readonly ModelInfo[]> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/models`, {
      headers: this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {},
    });
    if (!res.ok) return [];
    const body = await res.json() as { data?: { id: string }[] };
    const capabilities = this.opts.capabilities ?? ['chat'];
    return (body.data ?? []).map((m) => ({ id: m.id, capabilities }));
  }
}
