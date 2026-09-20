import type { NaroEvent } from '@naro/core';

/**
 * Metrics computed *from* the event stream — not a parallel instrument.
 * If it isn't an event, it isn't measured: the audit log and the metrics
 * can never disagree.
 */
export interface AgentMetrics {
  readonly totalEvents: number;
  readonly iterations: number;
  readonly actionsRequested: number;
  readonly actionsDenied: number;
  readonly approvalsRequested: number;
  readonly observations: number;
  readonly verifications: { total: number; passed: number; failed: number };
  readonly replans: number;
  readonly checkpoints: number;
  readonly durationMs: number;
  /** Token/cost totals when the model reports usage — undefined otherwise. */
  readonly usage?: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
}

export function computeMetrics(events: readonly NaroEvent[]): AgentMetrics {
  let iterations = 0, actionsRequested = 0, actionsDenied = 0,
      approvalsRequested = 0, observations = 0, replans = 0, checkpoints = 0,
      vTotal = 0, vPassed = 0;

  let usage: AgentMetrics['usage'];
  for (const e of events) {
    switch (e.type) {
      case 'reasoning.completed': iterations++; break;
      case 'action.requested': actionsRequested++; break;
      case 'action.denied': actionsDenied++; break;
      case 'human.approval.requested': approvalsRequested++; break;
      case 'observation.created': observations++; break;
      case 'verification.completed':
        vTotal++;
        if (e.data.ok) vPassed++;
        break;
      case 'replan.triggered': replans++; break;
      // totals is cumulative — the LAST model.usage carries the run sum.
      case 'model.usage': usage = {
        inputTokens: e.data.totals.inputTokens ?? 0,
        outputTokens: e.data.totals.outputTokens ?? 0,
        totalTokens: e.data.totals.totalTokens ?? 0,
        costUsd: e.data.totals.costUsd ?? 0,
      }; break;
      case 'checkpoint.created': checkpoints++; break;
      default: break;
    }
  }

  const first = events[0]?.at ?? 0;
  const last = events.at(-1)?.at ?? first;
  return {
    totalEvents: events.length,
    iterations,
    actionsRequested,
    actionsDenied,
    approvalsRequested,
    observations,
    verifications: { total: vTotal, passed: vPassed, failed: vTotal - vPassed },
    replans,
    checkpoints,
    durationMs: last - first,
    ...(usage !== undefined && { usage }),
  };
}
