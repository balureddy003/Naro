/**
 * Production coding agent — the reference deployment.
 *
 * Every earlier example demonstrates one concern in isolation and stays
 * offline on purpose (MockModel, allowAllPolicy, no durability — see each
 * README's "What this example does not claim"). This module is the
 * opposite: it's what `getting-started.md`'s tutorial and those examples
 * are building toward, wired together as one thing you could actually run.
 *
 *   naro serve examples/production-agent/src/agent.ts --pg <url>
 *
 * What's real here, not simulated:
 *   - a real model (AnthropicModel, not MockModel) — requires
 *     ANTHROPIC_API_KEY;
 *   - a policy gate that denies unknown tools and requires human approval
 *     for destructive actions (createToolPolicy, reading each tool's own
 *     `sideEffects` declaration — see profiles/coding/README.md);
 *   - provenance-aware denial: a destructive or write action triggered by
 *     externally-sourced evidence (a file the agent just read, a command's
 *     own output) is denied outright, not merely gated (ADR 0010);
 *   - a real verifier (CommandVerifier — completion is a claim, not a
 *     fact, until the configured check passes);
 *   - durable checkpoints, an exclusivity lease, and a shared approval
 *     queue — SQLite for one host, Postgres (via NARO_PG_URL) for a
 *     multi-replica `naro serve` deployment, same as the control plane
 *     itself (see stores.ts);
 *   - evidence export to JSONL always, OTLP when OTLP_ENDPOINT is set —
 *     the journal is the audit trail, not a debug log.
 *
 * What's still your job (see docs/production-readiness.md): a disposable
 * workspace per run (this points WORKSPACE_ROOT at one fixed directory —
 * fine for a demo, wrong for concurrent untrusted goals), secrets
 * management beyond `ANTHROPIC_API_KEY` in the environment, and TLS/tenant
 * authorization in front of `naro serve` itself.
 */
import { resolve } from 'node:path';
import { createAgentSpec, type Goal } from '@naro/core';
import { AnthropicModel } from '@naro/adapter-anthropic';
import type { Model } from '@naro/model';
import { ReActReasoner } from '@naro/reasoning';
import { AgentRunner, CompositeExecutor } from '@naro/runtime';
import { createToolPolicy, ToolExecutor, ToolRegistry } from '@naro/tools';
import { codingTools, WorkspaceEnvironment } from '@naro/profile-coding';
import { CommandVerifier, atCompletion } from '@naro/verification';
import { JsonlExporter, pipeTo } from '@naro/observability';
import { OtlpExporter } from '@naro/adapter-otel';
import { openStores, type Stores } from './stores.ts';

const SYSTEM_INSTRUCTIONS = [
  'You are a coding agent operating on a real workspace.',
  'Read before you write. Prefer the smallest change that satisfies the goal.',
  'Run the verification command yourself before claiming completion — a',
  "claim without evidence will be rejected by the runtime's own verifier.",
].join(' ');

export interface BuildOptions {
  readonly model: Model;
  readonly stores: Stores;
  readonly workspaceRoot: string;
  /** Shell command whose exit code gates completion. Omit to disable verification (tests only). */
  readonly verifyCommand?: string;
  readonly dataDir?: string;
  readonly otlpEndpoint?: string;
}

export interface BuiltAgent {
  readonly runner: AgentRunner;
  /**
   * Evidence export (JSONL, OTLP) is fire-and-forget while the run is live —
   * same tradeoff every exporter in this repo makes (see @naro/observability).
   * Call this after `run()` resolves and before anything that depends on the
   * journal file being complete (tests, or a clean process exit).
   */
  readonly flushEvidence: () => Promise<void>;
}

/**
 * The testable core: every dependency is passed in, nothing reads `process.env`.
 * `createRunner` below is the thin, env-reading `naro serve` entrypoint that
 * calls this with real production dependencies; agent.test.ts calls this
 * directly with a MockModel and in-memory-shaped stores.
 */
export function buildRunner(goal: Goal, opts: BuildOptions): BuiltAgent {
  const env = new WorkspaceEnvironment({ root: opts.workspaceRoot });
  const tools = codingTools(env);
  const registry = new ToolRegistry();
  for (const t of tools) registry.register(t);

  const toolSpecs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: { ...t.inputSchema } as Record<string, unknown>,
  }));

  const runner = new AgentRunner({
    spec: createAgentSpec({ name: 'production-coding-agent', goal }),
    reasoner: new ReActReasoner(opts.model, { tools: toolSpecs, instructions: SYSTEM_INSTRUCTIONS }),
    executor: new CompositeExecutor({ 'env://': env, 'tool://': new ToolExecutor(registry) }),
    // Destructive tools (delete_file, run_command) require approval; an
    // unknown tool:// name denies outright rather than silently no-op-ing;
    // a write or destructive action triggered by evidence the agent just
    // read (not the operator's own goal) is denied, not just gated —
    // the shape of a prompt-injection defense, not just a permission check.
    policy: createToolPolicy(registry, {
      approvalFor: ['destructive'],
      denyExternalTriggered: ['destructive', 'write'],
      unknownTool: 'deny',
    }),
    ...(opts.verifyCommand !== undefined && {
      verifier: atCompletion(new CommandVerifier(opts.verifyCommand, { cwd: opts.workspaceRoot })),
    }),
    human: opts.stores.approvals,
    grants: ['fs.read', 'fs.write', 'fs.delete', 'shell.exec'],
    checkpoints: opts.stores.checkpoints,
    lease: { store: opts.stores.lease, ttlMs: 30_000 },
    maxIterations: Number(process.env['NARO_MAX_ITERATIONS'] ?? 25),
    actionTimeoutMs: Number(process.env['NARO_ACTION_TIMEOUT_MS'] ?? 60_000),
    budgets: { maxTotalTokens: Number(process.env['NARO_MAX_TOTAL_TOKENS'] ?? 200_000) },
    ...(process.env['NARO_SEAL_KEY'] !== undefined && { sealKey: process.env['NARO_SEAL_KEY'] }),
  });

  const dataDir = opts.dataDir ?? '.naro';
  const taps = [pipeTo(runner, new JsonlExporter(`${dataDir}/journal.jsonl`))];
  if (opts.otlpEndpoint !== undefined) {
    taps.push(pipeTo(runner, new OtlpExporter({
      endpoint: opts.otlpEndpoint,
      serviceName: 'production-coding-agent',
      ...(process.env['OTLP_TOKEN'] !== undefined && { headers: { authorization: `Bearer ${process.env['OTLP_TOKEN']}` } }),
    })));
  }

  return {
    runner,
    flushEvidence: async () => { await Promise.all(taps.map((t) => t.flush())); },
  };
}

// --- naro serve entrypoint — resolved once at module load, not per goal ---

const workspaceRoot = resolve(process.env['WORKSPACE_ROOT'] ?? process.cwd());
const dataDir = process.env['NARO_DATA_DIR'] ?? '.naro';
const stores = await openStores(dataDir);

function requireModel(): Model {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (apiKey === undefined) {
    throw new Error(
      'ANTHROPIC_API_KEY is required — this module wires a real model, not ' +
      'MockModel. See agent.test.ts for the test-only path that injects one.',
    );
  }
  return new AnthropicModel(process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-5', { apiKey });
}

export function createRunner(goal: Goal): AgentRunner {
  return buildRunner(goal, {
    model: requireModel(),
    stores,
    workspaceRoot,
    dataDir,
    verifyCommand: process.env['NARO_VERIFY_COMMAND'] ?? 'npm test --silent',
    ...(process.env['OTLP_ENDPOINT'] !== undefined && { otlpEndpoint: process.env['OTLP_ENDPOINT'] }),
  }).runner;
}
