import type { Goal } from './goal.ts';
import type { Task } from './task.ts';
import type { Action } from './action.ts';
import type { Observation } from './observation.ts';
import type { AgentState } from './state.ts';
import type { ModelUsage } from './reasoner.ts';
import type { ContextItem } from './context.ts';

/**
 * Everything meaningful inside an agent execution is an event.
 *
 * Events are the backbone of observability: they power debugging, audit,
 * replay, evaluation, and UI streaming. If something happened and no
 * event was emitted — from Naro's perspective it didn't happen.
 *
 * Payloads are typed per event name, so `bus.on('action.denied', …)`
 * knows `event.data.action` exists at compile time.
 */
export interface EventDataMap {
  'agent.created':              { name: string };
  'goal.started':               { goal: Goal };
  'task.created':               { task: Task };
  'plan.created':               { tasks: Task[] };
  'context.retrieved':          { query: string; itemCount: number; items?: ContextItem[] };
  'reasoning.started':          { iteration: number };
  'reasoning.completed':        { iteration: number; decision: DecisionKind };
  /** Token/cost accounting for one model call, plus running totals. */
  'model.usage':                { iteration: number; usage: ModelUsage; totals: ModelUsage };
  'action.requested':           { action: Action };
  /** `policy` names the engine that produced the verdict (PolicyEngine.id). */
  'permission.requested':       { action: Action; policy?: string };
  'action.permitted':           { action: Action; policy?: string };
  'action.denied':              { action: Action; reason?: string; policy?: string };
  'action.started':             { action: Action };
  'action.completed':           { action: Action; observation: Observation };
  'observation.created':        { observation: Observation };
  'verification.started':       { subject: string };
  'verification.completed':     { ok: boolean; verifier?: string; reason?: string };
  'replan.triggered':           { reason: string };
  'memory.written':             { key: string };
  'checkpoint.created':         { checkpointId: string };
  /**
   * Kernel-level session compaction: events at or before `upToSeq` are
   * represented by `summary` when a session is rebuilt from the journal.
   * The events themselves are never rewritten — compaction is an event.
   */
  'session.compacted':          { upToSeq: number; summary: string; droppedObservations?: number };
  /** Terminal seal: the journal head signed by an Ed25519 key. `head`
   *  equals this event's `prev`, making the seal self-verifying — rewrite
   *  or extend the chain and the signature fails. */
  'journal.sealed':             { head: string; signature: string; publicKey: string; algorithm: 'ed25519' };
  'human.approval.requested':   { action?: Action; question?: string; policy?: string };
  /** `by` is the approver's control-plane identity, when the bridge knows it. */
  'human.approval.received':    { approved: boolean; note?: string; by?: string };
  'agent.state_changed':        { from: AgentState; to: AgentState };
  'agent.paused':               { reason?: string };
  'agent.resumed':              { checkpointId?: string };
  'agent.completed':            { result: unknown; usage?: ModelUsage };
  'agent.failed':               { error: string; usage?: ModelUsage };
  'agent.cancelled':            { reason?: string; usage?: ModelUsage };
}

export type EventType = keyof EventDataMap;
export type DecisionKind = 'plan' | 'act' | 'act-batch' | 'need-context' | 'wait-for-human' | 'complete' | 'fail';

/**
 * A NaroEvent is an immutable fact: it happened, at this time, in this
 * order (`seq` is monotonic per agent), attached to this agent and goal.
 *
 * Written as a distributive conditional so `NaroEvent` (no type arg) is a
 * *union* of per-type events — meaning `if (e.type === 'action.denied')`
 * narrows `e.data` correctly in handlers.
 */
export type NaroEvent<T extends EventType = EventType> = T extends T ? {
  readonly id: string;
  readonly type: T;
  /** Monotonic sequence number within one agent run — the audit ordering. */
  readonly seq: number;
  readonly at: number;
  readonly agentId: string;
  readonly goalId: string;
  /** Which execution of this agent produced it — a fresh run gets a fresh runId. */
  readonly runId: string;
  readonly data: EventDataMap[T];
  /**
   * Hash of the preceding event in this run's chain — `GENESIS_HASH` for the
   * first event. Absent on events written before chaining existed.
   */
  readonly prev?: string;
  /** sha256 over the canonical form of this event, excluding `hash`. */
  readonly hash?: string;
} : never;
