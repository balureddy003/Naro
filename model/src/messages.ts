/**
 * The provider-neutral message vocabulary every adapter translates
 * to/from (OpenAI, Anthropic, Ollama… each has its own wire format;
 * this is Naro's canonical one).
 */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** Non-text content for multimodal models (requires 'vision'). */
export interface ContentPart {
  readonly type: 'text' | 'image';
  readonly text?: string;
  readonly imageUrl?: string;
}

/** A tool invocation the model asked for (assistant) or answered (tool). */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown; // JSON-shaped arguments from the model
}

export interface ChatMessage {
  readonly role: Role;
  readonly content: string | readonly ContentPart[];
  /** assistant → tool invocations requested. */
  readonly toolCalls?: readonly ToolCall[];
  /** tool → id of the call this message answers. */
  readonly toolCallId?: string;
  readonly name?: string;
  /**
   * Cache-breakpoint hint: providers with explicit prompt caching (e.g.
   * Anthropic `cache_control`) treat everything up to and including this
   * message as the stable prefix. Providers that cache automatically
   * (OpenAI) ignore it. Place on the last static block — typically system
   * or retrieved context — never on volatile evidence.
   */
  readonly cacheBreakpoint?: boolean;
}

/** What a tool looks like to a model: name, docs, input schema. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema describing the tool's input. */
  readonly parameters: Record<string, unknown>;
}

export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
  /** Tools offered this turn (requires 'tool-calling'). */
  readonly tools?: readonly ToolSpec[];
  /** Constrain output shape (requires 'structured-output' for schema). */
  readonly responseFormat?: 'text' | 'json' | { type: 'schema'; schema: Record<string, unknown> };
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stop?: readonly string[];
  readonly signal?: AbortSignal;
  /** Mark the tool list as a cache breakpoint where the provider supports it. */
  readonly cacheTools?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type FinishReason = 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error';

/** Token/cost accounting — feeds evaluation and budget limits. */
export interface Usage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
}

export interface ChatResponse {
  readonly message: ChatMessage;
  readonly finishReason: FinishReason;
  readonly usage?: Usage;
  /** The concrete model that answered (a provider may route). */
  readonly model?: string;
}

export interface ChatChunk {
  readonly delta: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly done: boolean;
  readonly usage?: Usage;
}
