import {
  type ActionInput,
  type Decision,
  type ReasoningContext,
  type StatefulReasoner,
} from '@naro/core';
import { chat, stream, type ChatChunk, type ChatMessage, type ChatResponse, type Model, type ToolCall, type ToolSpec } from '@naro/model';
import { buildMessages, toolCallToAction } from './transcript.ts';

/**
 * ReAct — the canonical agent loop: think, act, observe, repeat.
 *
 * Each `decide()` shows the model the goal + evidence so far; if the model
 * answers with tool calls they become actions — one call → 'act', several
 * → 'act-batch' (parallel tool calls); if it answers with text, the agent
 * claims completion. The runtime owns pacing, permissions, and observation.
 */
export class ReActReasoner implements StatefulReasoner {
  readonly strategy: string = 'react';
  protected readonly model: Model;
  protected readonly tools: readonly ToolSpec[];
  private readonly instructions?: string;
  private readonly maxObservations?: number;
  private readonly onChunk?: (chunk: ChatChunk) => void;

  constructor(model: Model, options: {
    tools?: readonly ToolSpec[];
    instructions?: string;
    /** Evidence window cap — keeps transcripts inside provider context limits. */
    maxObservations?: number;
    /**
     * Stream tokens live: when set and the model supports streaming,
     * each chunk is forwarded here (UI progress, token telemetry) before
     * being folded into the normal response the decision is made on.
     */
    onChunk?: (chunk: ChatChunk) => void;
  } = {}) {
    this.model = model;
    this.tools = options.tools ?? [];
    this.instructions = options.instructions;
    this.maxObservations = options.maxObservations;
    this.onChunk = options.onChunk;
  }

  /** No internal state survives a decide — batches dispatch atomically. */
  captureState(): unknown { return {}; }
  restoreState(_state: unknown): void { /* stateless across checkpoints */ }

  async decide(ctx: ReasoningContext): Promise<Decision> {
    const req = {
      messages: this.messages(ctx),
      ...(this.tools.length > 0 && { tools: this.tools }),
    };
    const res = await (this.onChunk ? this.streamed(req) : chat(this.model, req));

    const calls = res.message.toolCalls ?? [];
    if (calls.length === 1) {
      return { kind: 'act', action: toolCallToAction(calls[0]!) };
    }
    if (calls.length > 1) {
      // Parallel tool calls — the runtime gates each, then runs them
      // concurrently. No per-cycle queue to checkpoint.
      return { kind: 'act-batch', actions: calls.map((c) => toolCallToAction(c)) };
    }

    if (res.finishReason === 'length') {
      return { kind: 'fail', reason: 'model response truncated (finish_reason=length)' };
    }
    const text = typeof res.message.content === 'string' ? res.message.content : JSON.stringify(res.message.content);
    return { kind: 'complete', result: text };
  }

  /** Fold a streamed response into a normal ChatResponse, forwarding chunks. */
  private async streamed(req: Parameters<typeof chat>[1]): Promise<ChatResponse> {
    let content = '';
    let toolCalls: ChatResponse['message']['toolCalls'];
    let finishReason: ChatResponse['finishReason'] = 'stop';
    let usage: ChatResponse['usage'];
    for await (const chunk of stream(this.model, req)) {
      this.onChunk?.(chunk);
      content += chunk.delta;
      if (chunk.toolCalls?.length) { toolCalls = chunk.toolCalls as ToolCall[]; finishReason = 'tool-calls'; }
      if (chunk.usage) usage = chunk.usage;
    }
    return {
      message: { role: 'assistant', content, ...(toolCalls && { toolCalls }) },
      finishReason, ...(usage && { usage }), model: this.model.id,
    };
  }

  /** Overridable: reflection and other strategies extend the transcript here. */
  protected messages(ctx: ReasoningContext): ChatMessage[] {
    return buildMessages(ctx, {
      ...(this.instructions !== undefined && { instructions: this.instructions }),
      ...(this.maxObservations !== undefined && { maxObservations: this.maxObservations }),
    });
  }
}
