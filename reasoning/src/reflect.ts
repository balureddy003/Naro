import { type Decision, type ReasoningContext } from '@naro/core';
import { chat, type ChatMessage, type Model, type ToolSpec } from '@naro/model';
import { ReActReasoner } from './react.ts';
import { buildMessages } from './transcript.ts';

/**
 * Reflection — ReAct plus self-critique.
 *
 * When a new failure observation appears, the reasoner asks the model to
 * write a one-line lesson ("what went wrong, what to try instead") which
 * is injected into every subsequent prompt. The runtime never sees the
 * difference — reflection is purely *inside* the strategy.
 */
export class ReflectionReasoner extends ReActReasoner {
  override readonly strategy = 'reflection';
  private readonly critiques: string[] = [];
  private readonly reflected = new Set<string>();
  private readonly critic: Model;

  constructor(model: Model, options: { tools?: readonly ToolSpec[]; instructions?: string; critic?: Model } = {}) {
    super(model, options);
    this.critic = options.critic ?? model;
  }

  override async decide(ctx: ReasoningContext): Promise<Decision> {
    for (const obs of ctx.observations) {
      if (obs.success || this.reflected.has(obs.id)) continue;
      this.reflected.add(obs.id);
      const res = await chat(this.critic, {
        messages: [
          { role: 'system', content: 'One sentence: what went wrong and what to try instead.' },
          { role: 'user', content: `Source: ${obs.source}\nError: ${obs.error ?? 'unknown'}\nGoal: ${ctx.goal.description}` },
        ],
      });
      const lesson = typeof res.message.content === 'string' ? res.message.content : '';
      if (lesson) this.critiques.push(lesson);
    }
    return super.decide(ctx);
  }

  protected override messages(ctx: ReasoningContext): ChatMessage[] {
    return buildMessages(ctx, { reflections: this.critiques });
  }
}
