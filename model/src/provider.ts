import type { Model } from './model.ts';
import type { ModelCapability } from './capabilities.ts';

export interface ModelInfo {
  readonly id: string;
  readonly capabilities: readonly ModelCapability[];
  readonly contextWindow?: number;
}

/**
 * A provider is a source of models — OpenAI, Ollama, vLLM, an
 * OpenAI-compatible endpoint, a local file. The core depends on this
 * interface; each provider is an adapter, and none is mandatory.
 */
export interface ModelProvider {
  readonly id: string;
  listModels(): Promise<readonly ModelInfo[]>;
  getModel(id: string): Promise<Model>;
}
