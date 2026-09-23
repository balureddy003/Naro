import {
  assertTransition,
  createAction,
  createTask,
  createObservation,
  isStopped,
  newId,
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
  type NaroEvent,
  type PolicyEngine,
  type Reasoner,
  type ReasoningContext,
  type StatefulReasoner,
  type Task,
  type TrustLevel,
  toVerdict,
  type Verifier,
} from '@naro/core';
import { EventBus } from './event-bus.ts';
import { recoverSession, readJournal, type JournalSource, type RecoveredSession } from './session.ts';
import { TimeoutError } from './timeout.ts';
import { retry, type RetryPolicy } from './retry.ts';
import { createCheckpoint, type CheckpointStore } from './checkpoint.ts';
import { noHumanBridge, type HumanBridge } from './human.ts';
import type { LeaseStore } from './lease.ts';

/** Everything needed to compose an agent — the wiring, not the smarts. */
export interface AgentDeps {
  readonly spec: AgentSpec;
  readonly reasoner: Reasoner;
  /** Routes actions to tools, environments, … (see CompositeExecutor). */
  readonly executor: ActionExecutor;
  /**
   * Gate every action passes through — REQUIRED, no implicit default.
   * Pass `allowAllPolicy` from @naro/core for tests/dev, or a real engine.
   * A missing policy would silently authorize everything, so we refuse
   * to guess.
   */
  readonly policy: PolicyEngine;
  /** Checks outcomes with evidence. Without one, completion is unverified. */
  readonly verifier?: Verifier;
  /** Answers approvals and questions in WAITING_FOR_HUMAN. */
  readonly human?: HumanBridge;
  /** Permissions granted to this agent; checked by the policy engine. */
  readonly grants?: readonly string[];
  /**
   * The principal this run acts on behalf of (ADR 0017) — included on
   * every PolicyContext so a rule can gate on *whose authority* an action
   * runs under, not just what the agent may do. `naro serve` sets it from
   * the authenticated caller.
   */
  readonly principal?: import('@naro/core').PolicyPrincipal;
  /** Resolves secret references for tools at exec time — never observed. */
  readonly secrets?: { resolve(ref: string): Promise<string | undefined> };
  /** Retrieves context for 'need-context' decisions. */
  readonly context?: ContextProvider;
  /** Long-term recall available to reasoners. */
  readonly memory?: MemoryReader;
  /** Enables pause/crash recovery when provided. */
  readonly checkpoints?: CheckpointStore;
  /**
   * Mutual exclusion: only one live runner may execute this agent.
   * The store owns the fencing (TTL); we heartbeat through the loop and
   * release on exit. Without it, two processes can double-run an agent.
   */
  readonly lease?: { store: LeaseStore; ttlMs?: number };
  /** Runaway protection — max reasoning cycles before FAILED. */
  readonly maxIterations?: number;
  /** Spend ceilings — the run fails fast when usage crosses them. */
  readonly budgets?: { maxTotalTokens?: number; maxCostUsd?: number };
  /** Per-action execution deadline (ms). 0 = no timeout. */
  readonly actionTimeoutMs?: number;
  /**
   * Ed25519 private key (PEM) used to seal the journal at run end —
   * `journal.sealed` signs the chain head, so the exported journal proves
   * it ends where this key-holder left it. Key custody is yours (KMS/HSM);
   * a paused run is NOT sealed — it may resume.
   */
  readonly sealKey?: string;
  /** Retry policy applied to action execution. Default: none. */
  readonly retry?: RetryPolicy;
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  /** Resume from the latest checkpoint (requires `checkpoints`). */
  readonly resume?: boolean;
  /**
   * Resume from the journal instead of a checkpoint — session as the
   * source of truth. Combined with `resume: true`; when present, no
   * checkpoint store is needed and `seq`/chain head continue from the
   * journal's last event.
   */
  readonly journal?: readonly NaroEvent[];
  /**
   * Caller-assigned run identity (fresh runs only — resumes take the
   * journal's runId). Lets an outer system (HTTP API, scheduler) correlate
   * its own run handle with the journal's `runId` on every event.
   */
  readonly runId?: string;
  /**
   * Correlates this run with a parent run across delegation — a child agent
   * reads the inherited value off `delegationConstraints(goal).traceId`
   * (`@naro/multiagent`) and passes it here so both runs' journals share
   * one trace. Defaults to this run's own `runId` (a root run is the root
   * of its own trace). Ignored on resume — the journal's traceId wins.
   */
  readonly traceId?: string;
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
  private readonly actions: Action[] = [];
  private readonly contextItems: ContextItem[] = [];
  private iteration = 0;
  /** Observations recorded during the previous iteration — the evidence
   *  the reasoner saw when it produced this iteration's decision. */
  private lastIterationObservations: readonly Observation[] = [];
  private iterObsStart = 0;
  private readonly usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
  private pauseRequested = false;
  private readonly deps: AgentDeps;

  constructor(deps: AgentDeps) {
    this.deps = deps;
    this.bus = new EventBus({ agentId: deps.spec.id, goalId: deps.spec.goal.id });
  }

  /** Subscribe to events — call before run(). */
  on: EventBus['on'] = (type, handler) => this.bus.on(type, handler);

  /**
   * A snapshot of this run's events so far — the same list `.run()`
   * returns as `RunResult.events` at completion, readable mid-run for
   * read-only inspection (e.g. `naro serve`'s `GET /runs/:id/evidence`).
   * Not a subscription; use `events()` for that.
   */
  history(): readonly NaroEvent[] {
    return this.bus.history();
  }

  /**
   * Live event stream as an async iterable — seeded with history so a
   * subscriber that arrives late sees the whole run, and closes on a
   * terminal event (completed / failed / cancelled / paused).
   *
   *   for await (const e of runner.events()) render(e);
   */
  events(): AsyncIterable<NaroEvent> {
    const TERMINAL = new Set(['agent.completed', 'agent.failed', 'agent.cancelled', 'agent.paused']);
    const queue: NaroEvent[] = [...this.bus.history()];
    let terminal = queue.some((e) => TERMINAL.has(e.type));
    let wake: (() => void) | undefined;
    const off = this.bus.on('*', (e) => {
      queue.push(e);
      if (TERMINAL.has(e.type)) terminal = true;
      wake?.();
    });
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<NaroEvent>> {
            for (;;) {
              const e = queue.shift();
              if (e !== undefined) return { done: false, value: e };
              if (terminal) { off(); return { done: true, value: undefined }; }
              await new Promise<void>((r) => { wake = r; });
            }
          },
        };
      },
    };
  }

  /** Request a pause; takes effect at the next reasoning boundary. */
  pause(): void {
    this.pauseRequested = true;
  }

  /**
   * Wake a run from its journal alone — no checkpoint required.
   * `source` is an event list or any store with `history()` (SQLite, Pg,
   * a parsed JSONL file). Without `runId`, the most recent run in the
   * journal for this agent continues. Chain, seq, and runId extend the
   * journal's last event, so the woken run reads as one audit trail.
   */
  async wake(
    source: JournalSource | readonly NaroEvent[],
    runId?: string,
  ): Promise<RunResult> {
    const base = await readJournal(
      source,
      runId !== undefined ? { runId } : { agentId: this.deps.spec.id },
    );
    let events = base.filter((e) => e.agentId === this.deps.spec.id);
    if (runId === undefined && events.length > 0) {
      const latest = events.reduce((a, b) => (b.seq > a.seq || b.at > a.at ? b : a)).runId;
      events = events.filter((e) => e.runId === latest);
    }
    if (events.length === 0) {
      throw new Error(`wake: no journal events for agent '${this.deps.spec.id}'${runId ? ` run '${runId}'` : ''} — refusing to start fresh under a resumed identity`);
    }
    if (events.at(-1)?.type === 'journal.sealed') {
      // A seal is a signature over finality — continuing it would break
      // the guarantee the signature makes.
      throw new Error(`wake: run '${events.at(-1)!.runId}' is sealed — the journal is signed as complete and cannot be resumed`);
    }
    return this.run({ resume: true, journal: events });
  }

  /**
   * Compact the session — a kernel operation on the journal, not a
   * prompt-side window. Emits `session.compacted` so the summary is part
   * of the audit trail, and swaps this runner's evidence list for the
   * summary plus the `keepObservations` most recent. Journals rebuilt by
   * `wake()` apply the same collapse.
   */
  compact(summary: string, opts: { keepObservations?: number } = {}): void {
    const keep = Math.max(0, opts.keepObservations ?? 0);
    const kept = this.observations.slice(-keep);
    const dropped = this.observations.length - kept.length;
    this.bus.emit('session.compacted', {
      upToSeq: this.bus.nextSeq() - 1,
      summary,
      ...(dropped > 0 && { droppedObservations: dropped }),
    });
    this.observations.splice(0, this.observations.length,
      createObservation({ source: 'session', kind: 'system', success: true, output: summary }),
      ...kept);
  }

  async run(options: RunOptions = {}): Promise<RunResult> {
    const { signal } = options;
    const { spec } = this.deps;
    let recovered: RecoveredSession | undefined;

    // Caller-assigned run identity — before any emit so every event of a
    // fresh run carries it. Resumes ignore it: the journal's runId wins.
    if (options.runId !== undefined && !options.resume) {
      this.bus.resumeJournal(options.runId, this.bus.nextSeq());
      // The bus already defaulted traceId to its OWN auto-generated runId
      // at construction, before this override — so without this, a root
      // run given an explicit runId but no explicit traceId would carry a
      // traceId that matches neither. Keep the "root run's traceId equals
      // its own runId" invariant (core/src/events.ts) intact through the
      // override, unless the caller explicitly set traceId themselves.
      if (options.traceId === undefined) this.bus.traceId = options.runId;
    }
    if (options.traceId !== undefined && !options.resume) {
      this.bus.traceId = options.traceId;
    }

    // A resumed run continues the prior journal — runId, sequence, and
    // hash-chain head — so every event of the resumed run links into the
    // same audit trail. Must happen before the first emit.
    if (options.resume) {
      if (options.journal !== undefined) {
        const s = recoverSession(options.journal);
        if (s.runId) {
          recovered = s;
          this.bus.resumeJournal(s.runId, s.seq, s.head);
        }
      } else {
        const cp = await this.deps.checkpoints?.latest(spec.id);
        if (cp?.data.runId) this.bus.resumeJournal(cp.data.runId, cp.data.seq ?? 0, cp.data.head);
      }
    }

    this.bus.emit('agent.created', { name: spec.name });
    this.bus.emit('goal.started', { goal: spec.goal });

    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const lease = this.deps.lease;
    const leaseKey = lease ? `agent:${spec.id}` : undefined;
    const holder = `${spec.id}:${this.bus.runId}`;

    try {
      this.transition('INITIALIZING');
      // Runner lease — a second process must fail here, not halfway
      // through a duplicated side effect.
      if (lease && leaseKey) {
        const ttl = lease.ttlMs ?? 30_000;
        if (!(await lease.store.acquire(leaseKey, holder, ttl))) {
          return this.finish('FAILED', 'failed', { error: `agent '${spec.id}' is already running (lease held)` });
        }
        heartbeat = setInterval(() => {
          void Promise.resolve(lease.store.heartbeat(leaseKey!, holder, ttl)).then((ok) => {
            if (!ok) this.bus.emit('replan.triggered', { reason: 'lease lost — another runner may have taken over' });
          });
        }, Math.max(1000, Math.floor(ttl / 3)));
        heartbeat.unref?.();
      }

      if (options.resume) {
        if (recovered) this.hydrateSession(recovered);
        else await this.resumeFromCheckpoint();
      } else {
        this.transition('UNDERSTANDING');
        this.transition('PLANNING');
      }

      while (true) {
        if (signal?.aborted) {
          // AbortSignal.reason is the cancel channel's envelope: a plain
          // string, or {reason, by} when a control plane attributes the
          // stop to a principal (ADR 0022).
          const r = signal.reason;
          const envelope = typeof r === 'object' && r !== null
            ? r as { reason?: unknown; by?: unknown }
            : undefined;
          return this.finish('CANCELLED', 'cancelled', {
            reason: String(envelope?.reason ?? r ?? 'aborted'),
            ...(typeof envelope?.by === 'string' && { by: envelope.by }),
          });
        }
        if (this.pauseRequested) {
          this.transition('PAUSED');
          this.bus.emit('agent.paused', {});
          await this.saveCheckpoint({ evenIfPaused: true });
          return { status: 'paused', state: this.state, events: this.bus.history() };
        }
        if (this.iteration >= (this.deps.maxIterations ?? 64)) {
          return this.finish('FAILED', 'failed', { error: `iteration limit ${this.deps.maxIterations ?? 64} exceeded` });
        }

        // From here to the end of the loop, control returns to REASONING.
        if (this.state !== 'REASONING') this.transition('REASONING');
        // Provenance window: what the reasoner saw before deciding now.
        this.lastIterationObservations = this.observations.slice(this.iterObsStart);
        this.iterObsStart = this.observations.length;
        this.bus.emit('reasoning.started', { iteration: this.iteration });
        const decision = await this.deps.reasoner.decide(this.reasoningContext());
        this.bus.emit('reasoning.completed', { iteration: this.iteration, decision: decision.kind });
        if (decision.usage) {
          const u = decision.usage;
          this.usage.inputTokens += u.inputTokens ?? 0;
          this.usage.outputTokens += u.outputTokens ?? 0;
          this.usage.totalTokens += u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
          this.usage.costUsd += u.costUsd ?? 0;
          this.bus.emit('model.usage', { iteration: this.iteration, usage: u, totals: { ...this.usage } });
          const b = this.deps.budgets;
          if (b?.maxTotalTokens !== undefined && this.usage.totalTokens > b.maxTotalTokens) {
            return this.finish('FAILED', 'failed', { error: `token budget ${b.maxTotalTokens} exceeded (${this.usage.totalTokens})` });
          }
          if (b?.maxCostUsd !== undefined && this.usage.costUsd > b.maxCostUsd) {
            return this.finish('FAILED', 'failed', { error: `cost budget $${b.maxCostUsd} exceeded ($${this.usage.costUsd})` });
          }
        }

        const outcome = await this.handle(decision, signal);
        if (outcome !== 'continue') return outcome;

        this.iteration++;
        await this.saveCheckpoint();
      }
    } catch (error) {
      return this.finish('FAILED', 'failed', { error: errorMessage(error) });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (lease && leaseKey) {
        await lease.store.release(leaseKey, `${spec.id}:${this.bus.runId}`);
      }
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
        this.bus.emit('context.retrieved', { query: decision.query, itemCount: items.length, items: [...items] });
        return 'continue'; // WAITING_FOR_CONTEXT → REASONING at loop top
      }

      case 'act':
        return this.act(decision.action, signal);

      case 'act-batch': {
        // Policy stays serial — approvals are human and can't parallel —
        // then permitted actions execute concurrently under one ACTING
        // phase, observed and verified as one batch.
        const gated: Action[] = [];
        for (const input of decision.actions) {
          const a = await this.gate(input);
          if (a) gated.push(a);
        }
        if (!gated.length) return 'continue';
        this.transition('ACTING');
        const observations = await Promise.all(gated.map((a) => this.execAction(a, signal)));
        this.transition('OBSERVING');
        for (const o of observations) this.record(o);
        await this.verifyAll(gated.map((a, i) => ({ action: a, observation: observations[i]! })));
        return 'continue';
      }

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
          this.bus.emit('verification.completed', {
            ok: v.ok, verifier: this.deps.verifier.id,
            ...(v.reason !== undefined && { reason: v.reason }),
          });
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
    const action = await this.gate(input);
    if (!action) return 'continue';
    this.transition('ACTING');
    const observation = await this.execAction(action, signal);
    this.transition('OBSERVING');
    this.record(observation);
    await this.verifyAll([{ action, observation }]);
    return 'continue';
  }

  /**
   * The policy gate: requested → (deny | approve → deny | permit).
   * Returns the authorized Action, or undefined when denied — a denial
   * is still recorded as an observation either way.
   */
  private async gate(input: ActionInput): Promise<Action | undefined> {
    const action = createAction(this.deps.spec.id, {
      ...input,
      // Replay-safe identity: a crash between side effect and checkpoint
      // reissues the same logical action at the same iteration — same key.
      idempotencyKey: input.idempotencyKey ?? `${this.bus.runId}:iter-${this.iteration}`,
    });
    this.actions.push(action);
    this.bus.emit('action.requested', { action });

    // Policy — every action, every time. The model can never self-authorize.
    // (Re-entrant: a batch gates several actions without leaving the gate.)
    // `policy` stamps WHICH engine judged — the evidence record reads it back.
    if (this.state !== 'WAITING_FOR_PERMISSION') this.transition('WAITING_FOR_PERMISSION');
    const policy = this.deps.policy.id;
    this.bus.emit('permission.requested', { action, ...(policy !== undefined && { policy }) });
    const { decision, reason } = toVerdict(await this.deps.policy.evaluate(action, {
      agentId: this.deps.spec.id,
      goal: this.deps.spec.goal,
      grants: this.deps.grants ?? [],
      provenance: this.provenance(),
      ...(this.deps.principal !== undefined && { principal: this.deps.principal }),
    }));

    if (decision === 'deny') {
      action.state = 'denied';
      this.bus.emit('action.denied', { action, ...(reason !== undefined && { reason }), ...(policy !== undefined && { policy }) });
      this.record(createObservation({
        actionId: action.id, source: 'policy', kind: 'error',
        success: false, error: reason ? `denied by policy: ${reason}` : 'action denied by policy',
      }));
      return undefined; // WAITING_FOR_PERMISSION → REASONING
    }

    // 'limit' and 'audit' are allow-variants: limit is enforced by the
    // engine's counters (deny once exhausted); audit just marks the record.
    if (decision === 'require_approval') {
      this.bus.emit('human.approval.requested', {
        action, ...(reason !== undefined && { question: reason }), ...(policy !== undefined && { policy }),
      });
      this.transition('WAITING_FOR_HUMAN');
      const res = await (this.deps.human ?? noHumanBridge).approve(action);
      this.bus.emit('human.approval.received', {
        approved: res.approved,
        ...(res.note !== undefined && { note: res.note }),
        ...(res.by !== undefined && { by: res.by }),
      });
      if (!res.approved) {
        action.state = 'denied';
        this.bus.emit('action.denied', { action, reason: res.note ?? 'approval refused', ...(policy !== undefined && { policy }) });
        this.record(createObservation({
          actionId: action.id, source: 'human', kind: 'human',
          success: false, error: res.note ?? 'approval refused',
        }));
        return undefined; // WAITING_FOR_HUMAN → REASONING
      }
      // Approved: fall through — still counts as permitted.
      this.transition('WAITING_FOR_PERMISSION');
    }

    action.state = 'authorized';
    this.bus.emit('action.permitted', { action, ...(policy !== undefined && { policy }) });
    if (action.taskId) this.setTaskStatus(action.taskId, 'running');
    return action;
  }

  /**
   * Execute an authorized action — NO state transitions here so batches
   * can run concurrently under a single ACTING phase. Returns the
   * observation (success or error); recording/verifying is the caller's.
   */
  private async execAction(action: Action, signal?: AbortSignal): Promise<Observation> {
    // 2. Execute — tool/env errors become observations, not crashes.
    action.state = 'running';
    this.bus.emit('action.started', { action });
    let observation: Observation;
    // A child controller per action: timeouts ABORT the executor (the
    // signal flows to envs/tools that honor it) instead of merely
    // abandoning the promise while the side effect continues.
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = this.deps.actionTimeoutMs
      ? setTimeout(() => ctrl.abort(new TimeoutError(this.deps.actionTimeoutMs!)), this.deps.actionTimeoutMs)
      : undefined;
    try {
      const ctx = {
        agentId: this.deps.spec.id,
        goalId: this.deps.spec.goal.id,
        goal: this.deps.spec.goal,
        grants: this.deps.grants ?? [],
        traceId: this.bus.traceId,
        ...(this.deps.secrets !== undefined && { secrets: this.deps.secrets }),
        signal: ctrl.signal,
      };
      const work = () => this.deps.executor.execute(action, ctx);
      observation = this.deps.retry
        ? await retry(() => work(), this.deps.retry, ctrl.signal)
        : await work();
      action.state = 'completed';
    } catch (error) {
      action.state = 'failed';
      observation = createObservation({
        actionId: action.id, source: 'executor', kind: 'error',
        success: false, error: errorMessage(error),
      });
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    this.bus.emit('action.completed', { action, observation });
    if (action.taskId) {
      this.setTaskStatus(action.taskId, observation.success ? 'completed' : 'failed',
        observation.success ? { result: observation.output } : { error: observation.error });
    }
    return observation;
  }

  /**
   * 3. Verify — one VERIFYING phase for the whole batch. Any failure
   * triggers REPLANNING and leaves the reasoner an observation naming
   * the verifier and the reason.
   */
  private async verifyAll(
    results: readonly { action: Action; observation: Observation }[],
  ): Promise<void> {
    if (!this.deps.verifier) return;
    this.transition('VERIFYING');
    let anyFailed = false;
    for (const { action, observation } of results) {
      this.bus.emit('verification.started', { subject: action.id });
      const v = await this.deps.verifier.verify({ goal: this.deps.spec.goal, observation });
      this.bus.emit('verification.completed', {
        ok: v.ok, verifier: this.deps.verifier.id,
        ...(v.reason !== undefined && { reason: v.reason }),
      });
      if (!v.ok) {
        anyFailed = true;
        this.record(createObservation({
          actionId: action.id, source: `verifier:${this.deps.verifier.id}`,
          kind: 'verification', success: false,
          error: v.reason ?? 'verification failed', output: v.evidence,
        }));
      }
    }
    if (anyFailed) {
      this.transition('REPLANNING');
      this.bus.emit('replan.triggered', { reason: 'verification failed' });
    }
  }

  /**
   * Lowest trust among the observations the reasoner saw last iteration —
   * 'external' < 'tool' < 'system'. Lets policy refuse side effects that
   * untrusted content may have talked the model into.
   */
  private provenance(): { lowest: TrustLevel; externalSources: readonly string[] } {
    const RANK: Record<TrustLevel, number> = { external: 0, tool: 1, system: 2 };
    let lowest: TrustLevel = 'system';
    const external = new Set<string>();
    for (const o of this.lastIterationObservations) {
      if (RANK[o.trust] < RANK[lowest]) lowest = o.trust;
      if (o.trust === 'external') external.add(o.source);
    }
    return { lowest, externalSources: [...external] };
  }

  // --- internals ---

  private reasoningContext(): ReasoningContext {
    return {
      agentId: this.deps.spec.id,
      goal: this.deps.spec.goal,
      state: this.state,
      tasks: [...this.tasks.values()],
      observations: this.observations,
      actions: this.actions,
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

  private async saveCheckpoint(opts: { evenIfPaused?: boolean } = {}): Promise<void> {
    const store = this.deps.checkpoints;
    if (!store) return;
    if (isStopped(this.state) && !(opts.evenIfPaused && this.state === 'PAUSED')) return;
    // Emit BEFORE capturing seq/head: the checkpoint must record the journal
    // position *including* this event, or the resumed run's first event
    // would reuse its seq and link past it — a fork in the hash chain.
    const id = newId('ckpt');
    this.bus.emit('checkpoint.created', { checkpointId: id });
    const cp = createCheckpoint(this.deps.spec.id, this.state, {
      iteration: this.iteration,
      tasks: [...this.tasks.values()],
      actions: this.actions,
      observations: this.observations,
      context: this.contextItems,
      ...((this.deps.reasoner as StatefulReasoner).captureState !== undefined && {
        reasonerState: (this.deps.reasoner as StatefulReasoner).captureState(),
      }),
      runId: this.bus.runId,
      seq: this.bus.nextSeq(),
      head: this.bus.head(),
    }, id);
    await store.save(cp);
  }

  /**
   * Hydrate run state from a journal-recovered session — the wake path.
   * Same end state as resumeFromCheckpoint, sourced from events.
   */
  private hydrateSession(s: RecoveredSession): void {
    for (const task of s.tasks) this.tasks.set(task.id, task);
    this.actions.push(...s.actions);
    this.observations.push(...s.observations);
    this.contextItems.push(...s.context);
    this.iteration = s.iteration;
    this.transition('RECOVERING');
    this.bus.emit('agent.resumed', {});
  }

  private async resumeFromCheckpoint(): Promise<void> {
    // INITIALIZING already happened in run() — lease acquisition is part of it.
    const cp = await this.deps.checkpoints?.latest(this.deps.spec.id);
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
    this.actions.push(...cp.data.actions);
    this.observations.push(...cp.data.observations);
    this.contextItems.push(...cp.data.context);
    this.iteration = cp.data.iteration;
    // Reasoner state (pending tool calls, plan flags) survives resume.
    const sr = this.deps.reasoner as StatefulReasoner;
    if (cp.data.reasonerState !== undefined && sr.restoreState) sr.restoreState(cp.data.reasonerState);
    // Journal continuation (runId, seq, chain head) already happened in
    // run() — before the first emit — so every event of this run links
    // into the original chain.
    this.transition('RECOVERING');
    this.bus.emit('agent.resumed', { checkpointId: cp.id });
  }

  private finish(
    to: 'COMPLETED' | 'FAILED' | 'CANCELLED',
    status: RunStatus,
    extra: { result?: unknown; error?: string; reason?: string; by?: string },
  ): RunResult {
    if (!isStopped(this.state)) this.transition(to);
    else if (this.state !== to) this.state = to; // already stopped (e.g. PAUSED→cancel)
    const usage = this.usage.totalTokens > 0 || this.usage.costUsd > 0 ? { usage: { ...this.usage } } : {};
    if (status === 'completed') this.bus.emit('agent.completed', { result: extra.result, ...usage });
    if (status === 'failed') this.bus.emit('agent.failed', { error: extra.error ?? 'unknown', ...usage });
    if (status === 'cancelled') this.bus.emit('agent.cancelled', {
      reason: extra.reason ?? '', ...(extra.by !== undefined && { by: extra.by }), ...usage,
    });
    // Seal last — the signature covers every event up to and including the
    // terminal one. Paused runs are deliberately unsealed: they resume.
    if (status !== 'paused' && this.deps.sealKey) this.bus.seal(this.deps.sealKey);
    const out: RunResult = { status, state: this.state, events: this.bus.history() };
    if (extra.result !== undefined) (out as { result?: unknown }).result = extra.result;
    if (extra.error !== undefined) (out as { error?: string }).error = extra.error;
    return out;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
