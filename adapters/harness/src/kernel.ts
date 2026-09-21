import {
  createAction, createGoal, createObservation, toVerdict,
  type Action, type Goal, type NaroEvent, type Observation,
  type PolicyEngine, type Verifier,
} from '@naro/core';
import { EventBus } from '@naro/runtime';

/** A tool call as a foreign harness reports it. */
export interface ForeignToolCall {
  readonly toolName: string;
  readonly input: unknown;
  /** The harness's call correlation id, if it has one. */
  readonly callId?: string;
}

/** What the harness should do with the call. */
export interface GateVerdict {
  /** 'ask' maps to the harness's own approval prompt where one exists. */
  readonly decision: 'allow' | 'deny' | 'ask';
  readonly reason?: string;
}

export interface HarnessKernelDeps {
  /** Identity stamped on every journaled event. */
  readonly agentId: string;
  readonly goal: Goal;
  /** The gate — required, same rule as AgentRunner. */
  readonly policy: PolicyEngine;
  readonly grants?: readonly string[];
  /** Supply your own bus to share a journal; otherwise one is created. */
  readonly bus?: EventBus;
  /** Optional completion verifier, run by endSession(). */
  readonly verifier?: Verifier;
}

/**
 * HarnessKernel — Naro governance beneath a foreign agent loop.
 *
 * The harness keeps its model, tools, and UI. Before it executes a tool it
 * calls `gateTool`; after, `observeTool`. Every decision and outcome lands
 * in a hash-chained Naro journal, so `naro verify` and `buildEvidence` work
 * on runs Naro did not drive.
 *
 * This governs *actions*, not the harness's internals: it cannot see model
 * calls that produce no tool use, and a harness that ignores a deny verdict
 * is out of scope — the journal records the verdict regardless.
 */
export class HarnessKernel {
  readonly bus: EventBus;
  private readonly deps: HarnessKernelDeps;
  /** callId → gated action, so post-tool results join their gate verdict. */
  private readonly pending = new Map<string, Action>();
  private seq = 0;

  constructor(deps: HarnessKernelDeps) {
    this.deps = deps;
    this.bus = deps.bus ?? new EventBus({ agentId: deps.agentId, goalId: deps.goal.id });
  }

  /** Session boundary — emit before the harness's first tool call. */
  startSession(): void {
    this.bus.emit('agent.created', { name: this.deps.agentId });
    this.bus.emit('goal.started', { goal: this.deps.goal });
  }

  /**
   * Pre-execution gate. Maps the foreign call to a Naro Action, runs the
   * policy engine, and journals the verdict — denied calls are evidence too.
   */
  async gateTool(call: ForeignToolCall): Promise<GateVerdict> {
    const action = createAction(this.deps.agentId, {
      capability: 'tool.invoke',
      target: `tool://${call.toolName}`,
      input: call.input,
      ...(call.callId !== undefined && { toolCallId: call.callId }),
    });
    this.bus.emit('action.requested', { action });
    this.bus.emit('permission.requested', { action });
    const { decision, reason } = toVerdict(await this.deps.policy.evaluate(action, {
      agentId: this.deps.agentId,
      goal: this.deps.goal,
      grants: this.deps.grants ?? [],
    }));

    if (decision === 'deny') {
      action.state = 'denied';
      this.bus.emit('action.denied', { action, ...(reason !== undefined && { reason }) });
      this.bus.emit('observation.created', { observation: createObservation({
        actionId: action.id, source: 'policy', kind: 'error',
        success: false, error: reason ?? 'action denied by policy',
      }) });
      return { decision: 'deny', reason: reason ?? 'denied by policy' };
    }
    if (decision === 'require_approval') {
      // The harness owns its approval UI; we record the requirement and
      // hand the decision back as 'ask'.
      this.bus.emit('human.approval.requested', { action });
      this.pending.set(call.callId ?? `seq-${this.seq++}`, action);
      return { decision: 'ask', reason: reason ?? 'requires approval' };
    }
    // 'allow', 'limit', 'audit' — proceed; audit is already in the journal.
    action.state = 'authorized';
    this.bus.emit('action.permitted', { action });
    this.pending.set(call.callId ?? `seq-${this.seq++}`, action);
    return { decision: 'allow' };
  }

  /**
   * Post-execution evidence. Pairs the result with the gated action (by
   * callId when the harness provides one, else most recent pending) and
   * journals action.started + action.completed + observation.created in
   * order — the harness owns actual execution, so both land here.
   */
  observeTool(call: ForeignToolCall, result: { output?: unknown; error?: string }): Observation {
    // callId joins result to its gate verdict; without one, pending is FIFO
    // (Map preserves insertion order) — harnesses run tools in issue order.
    const key = call.callId ?? this.pending.keys().next().value;
    const action = (key !== undefined ? this.pending.get(key) : undefined) ?? createAction(this.deps.agentId, {
      capability: 'tool.invoke', target: `tool://${call.toolName}`, input: call.input,
    });
    if (key !== undefined) this.pending.delete(key);

    action.state = 'running';
    this.bus.emit('action.started', { action });
    action.state = result.error ? 'failed' : 'completed';
    const observation = createObservation({
      actionId: action.id, source: `tool://${call.toolName}`, kind: 'tool-result',
      success: result.error === undefined,
      ...(result.output !== undefined && { output: result.output }),
      ...(result.error !== undefined && { error: result.error }),
    });
    this.bus.emit('action.completed', { action, observation });
    this.bus.emit('observation.created', { observation });
    return observation;
  }

  /**
   * Session end — journals the terminal event. With a verifier configured,
   * a claimed success is verified first; a failed verdict keeps the run
   * 'failed' with the reason, exactly like the in-kernel loop.
   */
  async endSession(outcome: { result?: unknown; error?: string; cancelled?: boolean }): Promise<{ ok: boolean; reason?: string }> {
    if (outcome.cancelled) {
      this.bus.emit('agent.cancelled', {});
      return { ok: true };
    }
    if (outcome.error !== undefined) {
      this.bus.emit('agent.failed', { error: outcome.error });
      return { ok: false, reason: outcome.error };
    }
    if (this.deps.verifier) {
      this.bus.emit('verification.started', { subject: 'goal' });
      const v = await this.deps.verifier.verify({ goal: this.deps.goal, result: outcome.result });
      this.bus.emit('verification.completed', {
        ok: v.ok, verifier: this.deps.verifier.id,
        ...(v.reason !== undefined && { reason: v.reason }),
      });
      if (!v.ok) {
        this.bus.emit('agent.failed', { error: `verification failed: ${v.reason ?? 'no reason'}` });
        return { ok: false, reason: v.reason };
      }
    }
    this.bus.emit('agent.completed', { result: outcome.result });
    return { ok: true };
  }

  /** The run's hash-chained journal — feed to verifyChain/buildEvidence/exporters. */
  journal(): readonly NaroEvent[] {
    return this.bus.history();
  }
}

/** Convenience: a kernel that only needs a description, not a Goal object. */
export function harnessKernel(
  deps: Omit<HarnessKernelDeps, 'goal'> & { goal: Goal | string },
): HarnessKernel {
  return new HarnessKernel({
    ...deps,
    goal: typeof deps.goal === 'string' ? createGoal({ description: deps.goal }) : deps.goal,
  });
}
