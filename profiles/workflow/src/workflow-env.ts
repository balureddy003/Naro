import { createAction, createObservation, type Action, type ActionExecutor, type ExecContext, type Observation } from '@naro/core';
import type { Environment, EnvironmentState } from '@naro/environment';

/**
 * A workflow agent's world: deterministic DAG execution.
 *
 * Agents are for the parts that need judgment; workflows are for the
 * parts that must be reliable. This environment runs a declared step
 * graph through a nested ActionExecutor — each step is still a real
 * capability-checked action, the DAG just decides the order.
 *
 * Capabilities:
 *   workflow.validate — static checks: dup ids, unknown deps, cycles (read)
 *   workflow.run      — topological execution with per-step retries (write)
 *
 * Step inputs may reference prior outputs: "$stepId" substitutes the
 * whole output, "$stepId.field.nested" drills in.
 */

export interface WorkflowStep {
  readonly id: string;
  readonly capability: string;
  /** Executor-facing target; defaults to workflow://<env>/<step>. */
  readonly target?: string;
  readonly input?: unknown;
  readonly dependsOn?: readonly string[];
  readonly retries?: number;
}

export interface WorkflowSpec {
  readonly steps: readonly WorkflowStep[];
}

export interface WorkflowResult {
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly completed: readonly string[];
  readonly failed?: { id: string; error: string };
  readonly durationMs: number;
}

export function validateWorkflow(spec: WorkflowSpec): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const s of spec.steps) {
    if (ids.has(s.id)) errors.push(`duplicate step id '${s.id}'`);
    ids.add(s.id);
  }
  for (const s of spec.steps) {
    for (const d of s.dependsOn ?? []) {
      if (!ids.has(d)) errors.push(`step '${s.id}' depends on unknown '${d}'`);
      if (d === s.id) errors.push(`step '${s.id}' depends on itself`);
    }
  }
  // cycle detection via DFS
  const visiting = new Set<string>(); const done = new Set<string>();
  const deps = new Map(spec.steps.map((s) => [s.id, s.dependsOn ?? []]));
  const visit = (id: string, path: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) { errors.push(`cycle: ${[...path, id].join(' → ')}`); return; }
    visiting.add(id);
    for (const d of deps.get(id) ?? []) if (deps.has(d)) visit(d, [...path, id]);
    visiting.delete(id); done.add(id);
  };
  for (const s of spec.steps) visit(s.id, []);
  return errors;
}

export interface WorkflowEnvOptions {
  /** Where steps execute — another environment, a tool executor, anything. */
  readonly executor: ActionExecutor;
}

export class WorkflowEnvironment implements Environment {
  readonly id: string;
  readonly capabilities = ['workflow.validate', 'workflow.run'];
  private readonly executor: ActionExecutor;

  constructor(opts: WorkflowEnvOptions, id = 'wf') {
    this.executor = opts.executor;
    this.id = id;
  }

  state(): EnvironmentState {
    return { at: Date.now(), resources: {} };
  }

  async execute(action: Action, ctx: ExecContext): Promise<Observation> {
    const input = (action.input ?? {}) as { spec?: WorkflowSpec };
    switch (action.capability) {
      case 'workflow.validate': {
        const errors = input.spec ? validateWorkflow(input.spec) : ['missing spec'];
        return this.obs(action, errors.length === 0, { ok: errors.length === 0, errors },
          errors.length ? errors.join('; ') : undefined);
      }
      case 'workflow.run': {
        if (!input.spec) return this.obs(action, false, undefined, 'missing spec');
        const errors = validateWorkflow(input.spec);
        if (errors.length) return this.obs(action, false, { errors }, `invalid workflow: ${errors.join('; ')}`);
        return this.obs(action, true, await this.run(input.spec, ctx));
      }
      default:
        return this.obs(action, false, undefined, `environment '${this.id}' does not support capability '${action.capability}'`);
    }
  }

  private async run(spec: WorkflowSpec, ctx: ExecContext): Promise<WorkflowResult> {
    const t0 = Date.now();
    const outputs: Record<string, unknown> = {};
    const completed: string[] = [];
    const remaining = new Map(spec.steps.map((s) => [s.id, s]));

    while (remaining.size) {
      // ready = all deps completed
      const ready = [...remaining.values()].filter((s) => (s.dependsOn ?? []).every((d) => d in outputs));
      if (!ready.length) {
        const stuck = [...remaining.keys()].join(', ');
        return { outputs, completed, failed: { id: stuck, error: 'deadlock — deps never satisfied' }, durationMs: Date.now() - t0 };
      }
      // sequential execution keeps observations ordered; parallelism needs per-step isolation
      const step = ready[0]!;
      remaining.delete(step.id);
      let lastErr = 'unknown';
      const attempts = 1 + (step.retries ?? 0);
      for (let i = 0; i < attempts; i++) {
        const obs = await this.executor.execute(
          createAction(ctx.agentId, {
            capability: step.capability,
            target: step.target ?? `workflow://${this.id}/${step.id}`,
            input: this.resolve(step.input, outputs),
          }), ctx);
        if (obs.success) { outputs[step.id] = obs.output; completed.push(step.id); lastErr = ''; break; }
        lastErr = obs.error ?? 'step failed';
      }
      if (lastErr) {
        return { outputs, completed, failed: { id: step.id, error: lastErr }, durationMs: Date.now() - t0 };
      }
    }
    return { outputs, completed, durationMs: Date.now() - t0 };
  }

  /** "$stepId" → whole output; "$stepId.a.b" → drilled value. */
  private resolve(input: unknown, outputs: Record<string, unknown>): unknown {
    if (typeof input === 'string') {
      const m = /^\$([\w-]+)((?:\.[\w-]+)*)$/.exec(input);
      if (m && m[1]! in outputs) {
        let v: unknown = outputs[m[1]!];
        for (const k of m[2]!.split('.').filter(Boolean)) v = (v as Record<string, unknown>)?.[k];
        return v;
      }
      return input;
    }
    if (Array.isArray(input)) return input.map((v) => this.resolve(v, outputs));
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, this.resolve(v, outputs)]));
    }
    return input;
  }

  private obs(action: Action, success: boolean, output?: unknown, error?: string): Observation {
    return createObservation({
      actionId: action.id, source: `env://${this.id}`, kind: 'env-change',
      success, ...(output !== undefined && { output }), ...(error !== undefined && { error }),
    });
  }
}
