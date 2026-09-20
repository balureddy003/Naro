import { createAgentSpec, type Goal } from '@naro/core';
import { AgentRunner, type AgentDeps, type RunResult, type RunStatus } from '@naro/runtime';
import { computeMetrics, type AgentMetrics } from '@naro/observability';

/**
 * One evaluable case: a goal + the agent wiring to attempt it + a check
 * on the outcome. Cases are self-contained so a suite can vary tools,
 * policies, and reasoners per case.
 */
export interface EvalCase {
  readonly id: string;
  readonly description?: string;
  readonly goal: Goal;
  readonly deps: Omit<AgentDeps, 'spec'>;
  /** Beyond "did it complete": did it complete *correctly*? */
  readonly check?: (result: RunResult) => boolean | { ok: boolean; reason?: string };
}

export interface EvalResult {
  readonly caseId: string;
  readonly status: RunStatus;
  readonly ok: boolean;
  readonly reason?: string;
  readonly result?: unknown;
  readonly metrics: AgentMetrics;
}

export interface EvalReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly passRate: number;
  readonly results: readonly EvalResult[];
  /** Aggregate metrics across all cases — cost/behavior profile. */
  readonly totals: Pick<AgentMetrics,
    'iterations' | 'actionsRequested' | 'actionsDenied' | 'replans' | 'durationMs'>;
}

/**
 * Runs a suite of cases through real agent runs and scores them.
 *
 * The insight: evaluation reads the *same event stream* the audit log
 * and metrics do — there is no separate measurement path to disagree
 * with reality. A benchmark is just N runs + per-case checks.
 */
export class BenchmarkRunner {
  async run(cases: readonly EvalCase[], options: { signal?: AbortSignal } = {}): Promise<EvalReport> {
    const results: EvalResult[] = [];

    for (const c of cases) {
      const runner = new AgentRunner({
        ...c.deps,
        spec: createAgentSpec({ name: c.id, goal: c.goal }),
      });
      const r = await runner.run({ ...(options.signal !== undefined && { signal: options.signal }) });
      const check = c.check?.(r);
      const ok = (typeof check === 'boolean' ? check : check?.ok) ?? (r.status === 'completed');
      const reason = typeof check === 'object' ? check.reason : undefined;
      results.push({
        caseId: c.id,
        status: r.status,
        ok,
        ...(reason !== undefined && { reason }),
        ...(r.result !== undefined && { result: r.result }),
        metrics: computeMetrics(r.events),
      });
    }

    const passed = results.filter((r) => r.ok).length;
    return {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length ? passed / results.length : 0,
      results,
      totals: {
        iterations: results.reduce((n, r) => n + r.metrics.iterations, 0),
        actionsRequested: results.reduce((n, r) => n + r.metrics.actionsRequested, 0),
        actionsDenied: results.reduce((n, r) => n + r.metrics.actionsDenied, 0),
        replans: results.reduce((n, r) => n + r.metrics.replans, 0),
        durationMs: results.reduce((n, r) => n + r.metrics.durationMs, 0),
      },
    };
  }
}

/** Pretty-print a report for CI logs. */
export function formatReport(report: EvalReport): string {
  const lines = report.results.map((r) =>
    `  ${r.ok ? '✓' : '✗'} ${r.caseId}  [${r.status}] ` +
    `${r.metrics.iterations} iters, ${r.metrics.actionsRequested} actions` +
    (r.reason ? `  — ${r.reason}` : ''));
  return [
    `Eval: ${report.passed}/${report.total} passed (${(report.passRate * 100).toFixed(0)}%)`,
    ...lines,
    `  totals: ${report.totals.iterations} iters, ${report.totals.actionsRequested} actions, ` +
    `${report.totals.actionsDenied} denied, ${report.totals.replans} replans`,
  ].join('\n');
}
