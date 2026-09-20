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
}

export function computeMetrics(events: readonly NaroEvent[]): AgentMetrics {
  let iterations = 0, actionsRequested = 0, actionsDenied = 0,
      approvalsRequested = 0, observations = 0, replans = 0, checkpoints = 0,
      vTotal = 0, vPassed = 0;

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
  };
}
