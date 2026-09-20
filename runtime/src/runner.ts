import {
  allowAllPolicy,
  assertTransition,
  createAction,
  createTask,
  createObservation,
  isStopped,
  type Action,
  type ActionExecutor,
  type ActionInput,
  type AgentSpec,
  type AgentState,
  type ContextItem,
  type ContextProvider,
  type Decision,
  type Observation,
  type MemoryReader,
  type PolicyEngine,
  type Reasoner,
  type ReasoningContext,
  type Task,
  type Verifier,
} from '@naro/core';
import { EventBus } from './event-bus.ts';
import { retry, type RetryPolicy } from './retry.ts';
import { withTimeout } from './timeout.ts';
import { createCheckpoint, type CheckpointStore } from './checkpoint.ts';
import { noHumanBridge, type HumanBridge } from './human.ts';

/** Everything needed to compose an agent — the wiring, not the smarts. */
export interface AgentDeps {
  readonly spec: AgentSpec;
  readonly reasoner: Reasoner;
  /** Routes actions to tools, environments, … (see CompositeExecutor). */
  readonly executor: ActionExecutor;
  /** Gate every action passes through. Default: allow-all (dev only!). */
  readonly policy?: PolicyEngine;
  /** Checks outcomes with evidence. Without one, completion is unverified. */
  readonly verifier?: Verifier;
  /** Answers approvals and questions in WAITING_FOR_HUMAN. */
  readonly human?: HumanBridge;
  /** Permissions granted to this agent; checked by the policy engine. */
  readonly grants?: readonly string[];
  /** Retrieves context for 'need-context' decisions. Phase-6 seam. */
  readonly context?: ContextProvider;
  /** Long-term recall available to reasoners. Phase-6 seam. */
  readonly memory?: MemoryReader;
  /** Enables pause/crash recovery when provided. */
  readonly checkpoints?: CheckpointStore;
  /** Runaway protection — max reasoning cycles before FAILED. */
  readonly maxIterations?: number;
  /** Per-action execution deadline (ms). 0 = no timeout. */
  readonly actionTimeoutMs?: number;
  /** Retry policy applied to action execution. Default: none. */
  readonly retry?: RetryPolicy;
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  /** Resume from the latest checkpoint (requires `checkpoints`). */
  readonly resume?: boolean;
}

export type RunStatus = 'completed' | 'failed' | 'cancelled' | 'paused';

export interface RunResult {
  readonly status: RunStatus;
  readonly state: AgentState;
  readonly result?: unknown;
  readonly error?: string;
  /** Full ordered event log — the audit trail of this run. */
  readonly events: readonly import('@naro/core').NaroEvent[];
}

/**
 * AgentRunner is the *only* place state transitions happen.
 *
 * It drives the universal loop —
 *   reason → (policy) → act → observe → verify → replan → repeat —
 * without knowing anything about models, tools, or domains. Every
 * cycle is bounded (`maxIterations`), cancellable (`AbortSignal`),
 * checkpointable, and fully evented.
 */
export class AgentRunner {
  private readonly bus: EventBus;
  private state: AgentState = 'CREATED';
  private readonly tasks = new Map<string, Task>();
  private readonly observations: Observation[] = [];
  private readonly contextItems: ContextItem[] = [];
  private iteration = 0;
  private pauseRequested = false;
  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    this.deps = deps;
    this.bus = new EventBus({ agentId: deps.spec.id, goalId: deps.spec.goal.id });
  }

  /** Subscribe to events — call before run(). */
  on: EventBus['on'] = (type, handler) => this.bus.on(type, handler);

  /** Request a pause; takes effect at the next reasoning boundary. */
  pause(): void {
    this.pauseRequested = true;
  }

  async run(options: RunOptions = {}): Promise<RunResult> {
    const { signal } = options;
    const { spec } = this.deps;

    this.bus.emit('agent.created', { name: spec.name });
    this.bus.emit('goal.started', { goal: spec.goal });

    try {
      if (options.resume) {
        await this.resumeFromCheckpoint();
      } else {
        this.transition('INITIALIZING');
        this.transition('UNDERSTANDING');
        this.transition('PLANNING');
      }

      while (true) {
        if (signal?.aborted) {
          return this.finish('CANCELLED', 'cancelled', { reason: String(signal.reason ?? 'aborted') });
        }
        if (this.pauseRequested) {
          this.transition('PAUSED');
          this.bus.emit('agent.paused', {});
          await this.saveCheckpoint();
          return { status: 'paused', state: this.state, events: this.bus.history() };
        }
        if (this.iteration >= (this.deps.maxIterations ?? 64)) {
          return this.finish('FAILED', 'failed', { error: `iteration limit ${this.deps.maxIterations ?? 64} exceeded` });
        }

        // From here to the end of the loop, control returns to REASONING.
        if (this.state !== 'REASONING') this.transition('REASONING');
        this.bus.emit('reasoning.started', { iteration: this.iteration });
        const decision = await this.deps.reasoner.decide(this.reasoningContext());
        this.bus.emit('reasoning.completed', { iteration: this.iteration, decision: decision.kind });

        const outcome = await this.handle(decision, signal);
        if (outcome !== 'continue') return outcome;

        this.iteration++;
        await this.saveCheckpoint();
      }
    } catch (error) {
      return this.finish('FAILED', 'failed', { error: errorMessage(error) });
    }
  }

  // --- decision handling: each branch ends in REASONING or a terminal ---

  private async handle(decision: Decision, signal?: AbortSignal): Promise<RunResult | 'continue'> {
    switch (decision.kind) {
      case 'plan': {
        const created = decision.tasks.map((t) => createTask({ ...t, goalId: this.deps.spec.goal.id }));
        for (const task of created) {
          this.tasks.set(task.id, task);
          this.bus.emit('task.created', { task });
        }
        this.bus.emit('plan.created', { tasks: created });
        return 'continue'; // stay in REASONING
      }

      case 'need-context': {
        this.transition('WAITING_FOR_CONTEXT');
        const items = (await this.deps.context?.retrieve(decision.query)) ?? [];
        this.contextItems.push(...items);
        this.bus.emit('context.retrieved', { query: decision.query, itemCount: items.length });
        return 'continue'; // WAITING_FOR_CONTEXT → REASONING at loop top
      }

      case 'act':
        return this.act(decision.action, signal);

      case 'wait-for-human': {
        this.transition('WAITING_FOR_HUMAN');
        this.bus.emit('human.approval.requested', { question: decision.question });
        const answer = await (this.deps.human ?? noHumanBridge).ask(decision.question);
        this.bus.emit('human.approval.received', { approved: true, note: answer });
        this.record(createObservation({
          source: 'human', kind: 'human', success: answer.length > 0, output: answer,
        }));
        return 'continue';
      }

      case 'complete': {
        if (this.deps.verifier) {
          this.transition('VERIFYING');
          this.bus.emit('verification.started', { subject: 'goal' });
          const v = await this.deps.verifier.verify({ goal: this.deps.spec.goal, result: decision.result });
          this.bus.emit('verification.completed', { ok: v.ok, ...(v.reason !== undefined && { reason: v.reason }) });
          if (!v.ok) {
            this.transition('REPLANNING');
            this.bus.emit('replan.triggered', { reason: v.reason ?? 'final verification failed' });
            this.record(createObservation({
              source: 'verifier', kind: 'verification', success: false,
              error: v.reason ?? 'final verification failed', output: v.evidence,
            }));
            return 'continue';
          }
        }
        return this.finish('COMPLETED', 'completed', { result: decision.result });
      }

      case 'fail':
        return this.finish('FAILED', 'failed', { error: decision.reason });
    }
  }

  // --- the act → observe → verify pipeline ---

  private async act(input: ActionInput, signal?: AbortSignal): Promise<RunResult | 'continue'> {
    const action = createAction(this.deps.spec.id, input);
    this.bus.emit('action.requested', { action });

    // 1. Policy — every action, every time. The model can never self-authorize.
    this.transition('WAITING_FOR_PERMISSION');
    this.bus.emit('permission.requested', { action });
    const verdict = await (this.deps.policy ?? allowAllPolicy).evaluate(action, {
      agentId: this.deps.spec.id,
      goal: this.deps.spec.goal,
      grants: this.deps.grants ?? [],
    });

    if (verdict === 'deny') {
      action.state = 'denied';
      this.bus.emit('action.denied', { action });
      this.record(createObservation({
        actionId: action.id, source: 'policy', kind: 'error',
        success: false, error: 'action denied by policy',
      }));
      return 'continue'; // WAITING_FOR_PERMISSION → REASONING
    }

    // 'limit' and 'audit' are allow-variants: limit is enforced by the
    // engine's counters (deny once exhausted); audit just marks the record.
    if (verdict === 'require_approval') {
      this.bus.emit('human.approval.requested', { action });
      this.transition('WAITING_FOR_HUMAN');
      const res = await (this.deps.human ?? noHumanBridge).approve(action);
      this.bus.emit('human.approval.received', { approved: res.approved, ...(res.note !== undefined && { note: res.note }) });
      if (!res.approved) {
        action.state = 'denied';
        this.bus.emit('action.denied', { action, reason: res.note ?? 'approval refused' });
        this.record(createObservation({
          actionId: action.id, source: 'human', kind: 'human',
          success: false, error: res.note ?? 'approval refused',
        }));
        return 'continue'; // WAITING_FOR_HUMAN → REASONING
      }
      // Approved: fall through — still counts as permitted.
      this.transition('WAITING_FOR_PERMISSION');
    }

    action.state = 'authorized';
    this.bus.emit('action.permitted', { action });
    if (action.taskId) this.setTaskStatus(action.taskId, 'running');

    // 2. Execute — tool/env errors become observations, not crashes.
    this.transition('ACTING');
    action.state = 'running';
    this.bus.emit('action.started', { action });
    let observation: Observation;
    try {
      const work = () => this.deps.executor.execute(action, {
        agentId: this.deps.spec.id,
        goalId: this.deps.spec.goal.id,
        ...(signal !== undefined && { signal }),
      });
      const executed = this.deps.retry
        ? retry(() => work(), this.deps.retry, signal)
        : work();
      observation = this.deps.actionTimeoutMs
        ? await withTimeout(executed, this.deps.actionTimeoutMs)
        : await executed;
      action.state = 'completed';
    } catch (error) {
      action.state = 'failed';
      observation = createObservation({
        actionId: action.id, source: 'executor', kind: 'error',
        success: false, error: errorMessage(error),
      });
    }
    this.bus.emit('action.completed', { action, observation });
    if (action.taskId) {
      this.setTaskStatus(action.taskId, observation.success ? 'completed' : 'failed',
        observation.success ? { result: observation.output } : { error: observation.error });
    }
    this.transition('OBSERVING');
    this.record(observation);

    // 3. Verify — optional; evidence over assertion.
    if (this.deps.verifier) {
      this.transition('VERIFYING');
      this.bus.emit('verification.started', { subject: action.id });
      const v = await this.deps.verifier.verify({ goal: this.deps.spec.goal, observation });
      this.bus.emit('verification.completed', { ok: v.ok, ...(v.reason !== undefined && { reason: v.reason }) });
      if (!v.ok) {
        this.transition('REPLANNING');
        this.bus.emit('replan.triggered', { reason: v.reason ?? 'verification failed' });
      }
    }
    return 'continue'; // → REASONING at loop top
  }

  // --- internals ---

  private reasoningContext(): ReasoningContext {
    return {
      agentId: this.deps.spec.id,
      goal: this.deps.spec.goal,
      state: this.state,
      tasks: [...this.tasks.values()],
      observations: this.observations,
      iteration: this.iteration,
      context: this.contextItems,
      ...(this.deps.memory !== undefined && { memory: this.deps.memory }),
    };
  }

  private setTaskStatus(taskId: string, status: Task['status'], extra?: { result?: unknown; error?: string }): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = status;
    if (extra?.result !== undefined) task.result = extra.result;
    if (extra?.error !== undefined) task.error = extra.error;
  }

  private record(observation: Observation): void {
    this.observations.push(observation);
    this.bus.emit('observation.created', { observation });
  }

  private transition(to: AgentState): void {
    assertTransition(this.state, to); // the machine cannot make illegal moves
    const from = this.state;
    this.state = to;
    this.bus.emit('agent.state_changed', { from, to });
  }

  private async saveCheckpoint(): Promise<void> {
    const store = this.deps.checkpoints;
    if (!store || isStopped(this.state)) return;
    const cp = createCheckpoint(this.deps.spec.id, this.state, {
      iteration: this.iteration,
      tasks: [...this.tasks.values()],
      observations: this.observations,
      context: this.contextItems,
    });
    await store.save(cp);
    this.bus.emit('checkpoint.created', { checkpointId: cp.id });
  }

  private async resumeFromCheckpoint(): Promise<void> {
    const cp = await this.deps.checkpoints?.latest(this.deps.spec.id);
    this.transition('INITIALIZING');
    if (!cp) {
      // Nothing to resume — fresh start through the normal path.
      this.transition('UNDERSTANDING');
      this.transition('PLANNING');
      return;
    }
    // Restore checkpointed data, then enter RECOVERING (legal from
    // INITIALIZING). Loop-top moves RECOVERING → REASONING: checkpoints
    // are only taken at reasoning boundaries, so we always resume there.
    for (const task of cp.data.tasks) this.tasks.set(task.id, task);
    this.observations.push(...cp.data.observations);
    this.contextItems.push(...cp.data.context);
    this.iteration = cp.data.iteration;
    this.transition('RECOVERING');
    this.bus.emit('agent.resumed', { checkpointId: cp.id });
  }

  private finish(
    to: 'COMPLETED' | 'FAILED' | 'CANCELLED',
    status: RunStatus,
    extra: { result?: unknown; error?: string; reason?: string },
  ): RunResult {
    if (!isStopped(this.state)) this.transition(to);
    else if (this.state !== to) this.state = to; // already stopped (e.g. PAUSED→cancel)
    if (status === 'completed') this.bus.emit('agent.completed', { result: extra.result });
    if (status === 'failed') this.bus.emit('agent.failed', { error: extra.error ?? 'unknown' });
    if (status === 'cancelled') this.bus.emit('agent.cancelled', { reason: extra.reason ?? '' });
    const out: RunResult = { status, state: this.state, events: this.bus.history() };
    if (extra.result !== undefined) (out as { result?: unknown }).result = extra.result;
    if (extra.error !== undefined) (out as { error?: string }).error = extra.error;
    return out;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
