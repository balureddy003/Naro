import {
  type ActionInput,
  type Decision,
  type Reasoner,
  type ReasoningContext,
} from '@naro/core';
import { chat, type ChatMessage, type Model, type ToolSpec } from '@naro/model';
import { buildMessages, toolCallToAction } from './transcript.ts';

/**
 * ReAct — the canonical agent loop: think, act, observe, repeat.
 *
 * Each `decide()` shows the model the goal + evidence so far; if the model
 * answers with tool calls, they become actions; if it answers with text,
 * the agent claims completion. Queued tool calls drain one per cycle —
 * the runtime owns pacing, permissions, and observation.
 */
export class ReActReasoner implements Reasoner {
  readonly strategy: string = 'react';
  protected readonly model: Model;
  protected readonly tools: readonly ToolSpec[];
  private readonly instructions?: string;
  private pending: ActionInput[] = [];

  constructor(model: Model, options: { tools?: readonly ToolSpec[]; instructions?: string } = {}) {
    this.model = model;
    this.tools = options.tools ?? [];
    this.instructions = options.instructions;
  }

  async decide(ctx: ReasoningContext): Promise<Decision> {
    if (this.pending.length > 0) return { kind: 'act', action: this.pending.shift()! };

    const res = await chat(this.model, {
      messages: this.messages(ctx),
      ...(this.tools.length > 0 && { tools: this.tools }),
    });

    const calls = res.message.toolCalls ?? [];
    if (calls.length > 0) {
      this.pending = calls.map((c) => toolCallToAction(c));
      return { kind: 'act', action: this.pending.shift()! };
    }

    if (res.finishReason === 'length') {
      return { kind: 'fail', reason: 'model response truncated (finish_reason=length)' };
    }
    const text = typeof res.message.content === 'string' ? res.message.content : JSON.stringify(res.message.content);
    return { kind: 'complete', result: text };
  }

  /** Overridable: reflection and other strategies extend the transcript here. */
  protected messages(ctx: ReasoningContext): ChatMessage[] {
    return buildMessages(ctx, { ...(this.instructions !== undefined && { instructions: this.instructions }) });
  }
}
