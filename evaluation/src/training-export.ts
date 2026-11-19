import type { Action, ContextItem, NaroEvent, Observation, ReasoningContext } from '@naro/core';
import { buildEvidence } from '@naro/observability';
import { buildMessages } from '@naro/reasoning';
import type { ChatMessage } from '@naro/model';

/**
 * One run turned into an SFT-ready transcript — the exact message
 * sequence a model would have seen, built by the same `buildMessages()`
 * a live run uses. Not a bespoke export format: whatever changes how
 * Naro renders a transcript for inference changes this too, by
 * construction rather than by remembering to keep two renderers in sync.
 */
export interface TrainingExample {
  readonly runId: string;
  readonly agentId: string;
  readonly goalId: string;
  /** `buildEvidence(...).goalVerification?.ok === true` for this run. */
  readonly verified: boolean;
  readonly outcome?: 'completed' | 'failed' | 'cancelled' | 'paused';
  readonly messages: readonly ChatMessage[];
}

export interface ExportOptions {
  /**
   * Default true. A claim without verification isn't evidence — Naro's
   * whole thesis — and that applies doubly to data used to train a
   * model. Pass false only when you specifically want unverified runs
   * too (e.g. auditing failures, not building a training set).
   */
  readonly verifiedOnly?: boolean;
  /** Forwarded to buildMessages — cap the evidence window per example. */
  readonly maxObservations?: number;
}

/**
 * Group a mixed event stream by `runId` and turn each run into one
 * `TrainingExample`. Events are otherwise read-only: nothing here writes
 * to the journal, and a run with no `goal.started` is skipped rather than
 * guessed at.
 */
export function exportTrainingExamples(
  events: readonly NaroEvent[],
  options: ExportOptions = {},
): readonly TrainingExample[] {
  const verifiedOnly = options.verifiedOnly ?? true;
  const byRun = new Map<string, NaroEvent[]>();
  for (const e of events) {
    const bucket = byRun.get(e.runId);
    if (bucket) bucket.push(e); else byRun.set(e.runId, [e]);
  }

  const examples: TrainingExample[] = [];
  for (const [runId, runEvents] of byRun) {
    const example = buildExample(runId, runEvents.sort((a, b) => a.seq - b.seq), options);
    if (example && (!verifiedOnly || example.verified)) examples.push(example);
  }
  return examples;
}

function buildExample(
  runId: string,
  sorted: readonly NaroEvent[],
  options: ExportOptions,
): TrainingExample | undefined {
  const started = sorted.find((e) => e.type === 'goal.started');
  if (!started) return undefined; // no goal recorded — nothing to render

  const actions = new Map<string, Action>();
  const observations: Observation[] = [];
  const context: ContextItem[] = [];
  let iteration = 0;

  for (const e of sorted) {
    switch (e.type) {
      case 'action.requested':
        actions.set(e.data.action.id, e.data.action);
        break;
      case 'observation.created':
        observations.push(e.data.observation);
        break;
      case 'context.retrieved':
        if (e.data.items) context.push(...e.data.items);
        break;
      case 'reasoning.started':
        iteration = e.data.iteration;
        break;
      default:
        break;
    }
  }

  const ctx: ReasoningContext = {
    agentId: started.agentId,
    goal: started.data.goal,
    state: 'COMPLETED',
    tasks: [],
    actions: [...actions.values()],
    observations,
    context,
    iteration,
  };

  const evidence = buildEvidence(sorted);
  return {
    runId,
    agentId: started.agentId,
    goalId: started.goalId,
    verified: evidence.goalVerification?.ok === true,
    ...(evidence.outcome?.status !== undefined && { outcome: evidence.outcome.status }),
    messages: buildMessages(ctx, options.maxObservations !== undefined
      ? { maxObservations: options.maxObservations }
      : undefined),
  };
}

/** Serialize as JSONL — one example per line, the common SFT dataset shape. */
export function toJsonl(examples: readonly TrainingExample[]): string {
  return examples.map((e) => JSON.stringify(e)).join('\n') + (examples.length ? '\n' : '');
}
