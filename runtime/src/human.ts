import type { Action } from '@naro/core';

/**
 * The bridge between an agent and a human in the loop.
 *
 * Two requests exist: `approve` (gate an action the policy flagged) and
 * `ask` (the reasoner needs information only a person has). Both return
 * promises — the agent sits in WAITING_FOR_HUMAN until resolved.
 */
export interface HumanBridge {
  /**
   * `by` is the responder's identity when the bridge knows it (e.g. the
   * principal that posted to `POST /approvals/:id`) — the runner stamps it
   * on `human.approval.received`, so approver attribution lands in the
   * journal, not only in the bridge's table.
   */
  approve(action: Action, question?: string): Promise<{ approved: boolean; note?: string; by?: string }>;
  ask(question: string): Promise<string>;
}

/** Safe default: approvals are denied, questions get no answer. */
export const noHumanBridge: HumanBridge = {
  approve: () => Promise.resolve({ approved: false, note: 'no human bridge configured' }),
  ask: () => Promise.resolve(''),
};
