import type { Goal } from './goal.ts';
import type { Task, TaskInput } from './task.ts';
import type { Action, ActionInput } from './action.ts';
import type { Observation } from './observation.ts';
import type { AgentState } from './state.ts';
import type { ContextItem } from './context.ts';
import type { MemoryReader } from './memory.ts';

/**
 * A Decision is the only thing a reasoner can produce.
 *
 * Keeping this a small closed union is the whole point: the runtime
 * knows every possible thing a reasoning strategy can ask for, so any
 * strategy — ReAct, tree search, a rules engine, a human — plugs in
 * without the runtime learning anything new.
 */
/** Token/cost accounting surfaced by the model call behind a decision. */
export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
}

export type Decision =
  | { kind: 'plan';           tasks: readonly TaskInput[]; usage?: ModelUsage }
  | { kind: 'act';            action: ActionInput;          usage?: ModelUsage }
  /** Several independent calls in one cycle — parallel tool calls. */
  | { kind: 'act-batch';      actions: readonly ActionInput[]; usage?: ModelUsage }
  | { kind: 'need-context';   query: string;                usage?: ModelUsage }
  | { kind: 'wait-for-human'; question: string;             usage?: ModelUsage }
  | { kind: 'complete';       result: unknown;              usage?: ModelUsage }
  | { kind: 'fail';           reason: string;               usage?: ModelUsage };

/** Everything a reasoner is allowed to see when deciding. */
export interface ReasoningContext {
  readonly agentId: string;
  readonly goal: Goal;
  readonly state: AgentState;
  readonly tasks: readonly Task[];
  /** Every observation so far, in order — the agent's evidence trail. */
  readonly observations: readonly Observation[];
  /** Every action taken so far — lets strategies rebuild faithful transcripts. */
  readonly actions: readonly Action[];
  /** How many reasoning cycles have run. Backed by `maxIterations`. */
  readonly iteration: number;
  /** Context retrieved so far this run (see 'need-context' decisions). */
  readonly context: readonly ContextItem[];
  /** Long-term recall — absent if no memory store is attached. */
  readonly memory?: MemoryReader;
}

/**
 * A Reasoner controls *how* a model's capabilities are used.
 * The model provides intelligence; the reasoner provides strategy.
 * Implementations must be pure-ish: decide from context, produce a
 * Decision — never reach for tools or environments directly.
 */
export interface Reasoner {
  readonly strategy: string;
  decide(ctx: ReasoningContext): Promise<Decision> | Decision;
}

/**
 * A reasoner with internal state that must survive checkpoints —
 * pending tool calls, plan flags, accumulated lessons. The runner calls
 * `captureState` before saving a checkpoint and `restoreState` on resume.
 * Reasoners without it resume stateless — document that or implement it.
 */
export interface StatefulReasoner extends Reasoner {
  captureState(): unknown;
  restoreState(state: unknown): void;
}
