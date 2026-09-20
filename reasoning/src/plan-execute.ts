import {
  type ActionInput,
  type Decision,
  type Reasoner,
  type ReasoningContext,
  type Task,
  type TaskInput,
} from '@naro/core';
import { chat, type ChatMessage, type Model } from '@naro/model';

interface PlannedStep {
  description: string;
  action?: ActionInput;
}

/**
 * Plan-Execute — separate *what to do* from *doing it*.
 *
 * First call: the model produces a JSON plan (a list of steps, each with
 * an optional action). Later calls: the next ready task's action is
 * dispatched with its `taskId`, so the runtime tracks real task status.
 * When every task completes, the agent completes with their results.
 */
export class PlanExecuteReasoner implements Reasoner {
  readonly strategy = 'plan-execute';
  private readonly model: Model;
  private planned = false;

  constructor(model: Model) {
    this.model = model;
  }

  /** Whether the plan was issued — without it, resume re-plans on top of tasks. */
  captureState(): unknown { return { planned: this.planned }; }
  restoreState(state: unknown): void {
    this.planned = (state as { planned?: boolean }).planned ?? false;
  }

  async decide(ctx: ReasoningContext): Promise<Decision> {
    if (!this.planned) {
      this.planned = true;
      return this.plan(ctx);
    }
    const next = this.nextReady(ctx.tasks);
    if (!next) {
      const allDone = ctx.tasks.every((t) => t.status === 'completed');
      if (allDone && ctx.tasks.length > 0) {
        return { kind: 'complete', result: ctx.tasks.map((t) => ({ task: t.description, result: t.result })) };
      }
      return { kind: 'fail', reason: 'plan has no runnable tasks left' };
    }
    const action = next.metadata['action'] as ActionInput | undefined;
    if (!action) return { kind: 'fail', reason: `task '${next.id}' carries no action` };
    return { kind: 'act', action: { ...action, taskId: next.id } };
  }

  private async plan(ctx: ReasoningContext): Promise<Decision> {
    const messages: ChatMessage[] = [
      { role: 'system', content:
        'Produce a plan as a JSON array of steps: [{"description": string, "action": {"capability": string, "target": string, "input": any}}]. Reply with JSON only.' },
      { role: 'user', content: `GOAL: ${ctx.goal.description}\nSUCCESS: ${ctx.goal.successCriteria.join('; ')}` },
    ];
    const res = await chat(this.model, { messages, responseFormat: 'json' });
    const text = typeof res.message.content === 'string' ? res.message.content : '';
    try {
      const steps = JSON.parse(text) as PlannedStep[];
      if (!Array.isArray(steps) || steps.length === 0) throw new Error('empty plan');
      const tasks: TaskInput[] = steps.map((s) => ({
        goalId: ctx.goal.id,
        description: s.description,
        ...(s.action !== undefined && { metadata: { action: s.action } }),
      }));
      return { kind: 'plan', tasks };
    } catch (e) {
      return { kind: 'fail', reason: `could not produce a valid plan: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  private nextReady(tasks: readonly Task[]): Task | undefined {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return tasks.find((t) =>
      (t.status === 'created' || t.status === 'ready')
      && t.dependsOn.every((d) => byId.get(d)?.status === 'completed'));
  }
}
