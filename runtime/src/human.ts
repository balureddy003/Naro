import type { Action } from '@naro/core';

/**
 * The bridge between an agent and a human in the loop.
 *
 * Two requests exist: `approve` (gate an action the policy flagged) and
 * `ask` (the reasoner needs information only a person has). Both return
 * promises — the agent sits in WAITING_FOR_HUMAN until resolved.
 */
export interface HumanBridge {
  approve(action: Action, question?: string): Promise<{ approved: boolean; note?: string }>;
  ask(question: string): Promise<string>;
}

/** Safe default: approvals are denied, questions get no answer. */
export const noHumanBridge: HumanBridge = {
  approve: () => Promise.resolve({ approved: false, note: 'no human bridge configured' }),
  ask: () => Promise.resolve(''),
};
