import { createAgentSpec } from '@naro/core';
import { AgentRunner, type HumanBridge, type RunRegistry } from '@naro/runtime';
import { codeChangeTemplate, type CodeChangeInput } from '@naro/templates';
import type { Model } from '@naro/model';

/**
 * SoftwareFactory — a queue of code-change jobs across one or more
 * workspaces, each run through the existing kernel (policy gate, verifier,
 * hash-chained journal) and indexed in the same `RunRegistry` `naro serve`
 * uses, so a factory job shows up in the same `/runs` listing and evidence
 * record as any other run. This is an application of the kernel, the same
 * way `dogfood/` is — it owns no state transition `AgentRunner` doesn't
 * already own. All it adds is fanning a batch of goals out to many
 * runners and giving them one shared name (`factory:<repo>:<job id>`) so a
 * registry/dashboard can group them.
 *
 * What this is not: a scheduler with retry policies, priority, or
 * concurrency limits (submit as many jobs as your process and budgets can
 * run at once — that ceiling is `AgentDeps.budgets` and your own process,
 * not something this class manages); a dispatcher to an *external* harness
 * session (Claude Code, Devin) — that's `HarnessKernel` wrapping an
 * existing interactive session, a different composition for a different
 * case (see `@naro/adapter-harness`). Every job here runs Naro's own
 * reasoner loop against `codeChangeTemplate`.
 */

export interface FactoryJob {
  readonly id: string;
  /** A label for grouping in the registry/dashboard — not a filesystem
   *  path. One factory can process jobs against several repos at once;
   *  `workspaceRoot` says where this job's files actually live. */
  readonly repo: string;
  readonly task: string;
  readonly workspaceRoot: string;
  readonly verifyCommand?: string;
  readonly budget?: { maxTotalTokens?: number; maxCostUsd?: number };
  readonly maxIterations?: number;
}

export interface FactoryJobStatus {
  readonly id: string;
  readonly runId: string;
  readonly repo: string;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  readonly result?: unknown;
  readonly error?: string;
}

export interface SoftwareFactoryDeps {
  readonly cheap: Model;
  readonly strong?: Model;
  readonly registry: RunRegistry;
  /** Approval bridge for destructive actions (delete_file, run_command) —
   *  omit only for fully unattended jobs where that's an accepted risk;
   *  without one, a destructive action blocks forever (no human to ask). */
  readonly human?: HumanBridge;
  readonly host?: string;
}

export class SoftwareFactory {
  private readonly jobs = new Map<string, FactoryJobStatus>();
  private readonly deps: SoftwareFactoryDeps;

  constructor(deps: SoftwareFactoryDeps) {
    this.deps = deps;
  }

  /** Submit one job. Returns immediately — the run proceeds in the
   *  background; poll `status(job.id)` or read the shared `RunRegistry`. */
  submit(job: FactoryJob): { runId: string } {
    const existing = this.jobs.get(job.id);
    if (existing) return { runId: existing.runId };

    const runId = `factory_${job.id}`;
    const specName = `factory:${job.repo}:${job.id}`;
    const host = this.deps.host ?? 'factory';
    const startedAt = Date.now();

    const input: CodeChangeInput = {
      task: job.task,
      workspaceRoot: job.workspaceRoot,
      ...(job.verifyCommand !== undefined && { verifyCommand: job.verifyCommand }),
      ...(job.budget !== undefined && { budget: job.budget }),
      ...(job.maxIterations !== undefined && { maxIterations: job.maxIterations }),
    };
    const built = codeChangeTemplate.build(input, {
      cheap: this.deps.cheap,
      ...(this.deps.strong !== undefined && { strong: this.deps.strong }),
    });
    const runner = new AgentRunner({
      ...built,
      spec: { ...built.spec, name: specName },
      ...(this.deps.human !== undefined && { human: this.deps.human }),
    });

    let agentId = '';
    this.jobs.set(job.id, { id: job.id, runId, repo: job.repo, status: 'running' });

    runner.on('goal.started', (e) => { agentId = e.agentId; });
    void this.deps.registry.upsert({
      runId, agentId: '', status: 'running', goal: job.task,
      startedAt, updatedAt: startedAt, host, specName,
    });

    runner.run({ runId }).then((r) => {
      this.jobs.set(job.id, {
        id: job.id, runId, repo: job.repo, status: r.status,
        ...(r.result !== undefined && { result: r.result }),
        ...(r.error !== undefined && { error: r.error }),
      });
      void this.deps.registry.upsert({
        runId, agentId, status: r.status, goal: job.task,
        startedAt, updatedAt: Date.now(), host, specName,
        ...(r.result !== undefined && { result: r.result }),
        ...(r.error !== undefined && { error: r.error }),
      });
    }).catch((e) => {
      const error = e instanceof Error ? e.message : String(e);
      this.jobs.set(job.id, { id: job.id, runId, repo: job.repo, status: 'failed', error });
      void this.deps.registry.upsert({
        runId, agentId, status: 'failed', goal: job.task,
        startedAt, updatedAt: Date.now(), host, specName, error,
      });
    });

    return { runId };
  }

  status(jobId: string): FactoryJobStatus | undefined {
    return this.jobs.get(jobId);
  }

  /** Every job this process has submitted, most-recently-submitted order
   *  not guaranteed — read the shared `RunRegistry` for a durable,
   *  cross-process listing (what a real dashboard should use). */
  list(): readonly FactoryJobStatus[] {
    return [...this.jobs.values()];
  }
}
