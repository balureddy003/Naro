import { CapabilityNotSupportedError } from '@naro/core';
import type { ModelCapability } from './capabilities.ts';
import type { ChatChunk, ChatRequest, ChatResponse } from './messages.ts';

/**
 * The model contract — intelligence as a capability set.
 *
 * `chat` is the only required method; everything else is optional and
 * gated by `capabilities`. Adapters translate provider wire formats into
 * this interface; agent code never sees a provider SDK.
 */
export interface Model {
  readonly id: string;
  readonly provider: string;
  readonly capabilities: ReadonlySet<ModelCapability>;

  chat(request: ChatRequest): Promise<ChatResponse>;

  /** Requires 'streaming'. */
  stream?(request: ChatRequest): AsyncIterable<ChatChunk>;
  /** Requires 'embeddings'. */
  embed?(texts: readonly string[]): Promise<readonly number[][]>;
  /** Requires 'reranking'. */
  rerank?(query: string, documents: readonly string[]): Promise<readonly number[]>;
}

/** Throws CapabilityNotSupportedError if the model lacks `capability`. */
export function requireCapability(model: Model, capability: ModelCapability): void {
  if (!model.capabilities.has(capability)) {
    throw new CapabilityNotSupportedError(capability, `model '${model.id}'`);
  }
}

/** Capability-checked chat — the safe way to call any model. */
export async function chat(model: Model, request: ChatRequest): Promise<ChatResponse> {
  requireCapability(model, 'chat');
  if (request.tools?.length) requireCapability(model, 'tool-calling');
  if (typeof request.responseFormat === 'object') requireCapability(model, 'structured-output');
  return model.chat(request);
}

/** Capability-checked streaming. */
export async function* stream(model: Model, request: ChatRequest): AsyncIterable<ChatChunk> {
  requireCapability(model, 'streaming');
  if (!model.stream) throw new CapabilityNotSupportedError('streaming', `model '${model.id}'`);
  yield* model.stream(request);
}
