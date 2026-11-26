import { createAgentSpec, createGoal, type Goal } from '@naro/core';
import { EscalatingReasoner, ReActReasoner, toToolSpec } from '@naro/reasoning';
import { CompositeExecutor, type AgentDeps } from '@naro/runtime';
import { createToolPolicy, ToolExecutor, ToolRegistry } from '@naro/tools';
import { codingTools, WorkspaceEnvironment } from '@naro/profile-coding';
import { CommandVerifier, atCompletion } from '@naro/verification';
import type { OutcomeTemplate, TemplateDeps } from './template.ts';

/**
 * Code change — a coding task against a real, jailed workspace, verified by
 * actually running the project's own check command rather than trusting the
 * model's claim that it's done.
 *
 * This is the same composition `examples/production-agent` wires by hand
 * (`@naro/profile-coding` + `CommandVerifier` + an approval-gated policy),
 * packaged as a template so a caller states a task and a workspace instead
 * of assembling `WorkspaceEnvironment`, tool registration, and policy rules
 * from scratch. Unlike the two PRD-002 templates, the verifier here is a
 * real shell command with real side effects on a real filesystem — least
 * privilege is enforced by policy and the workspace jail, not by the tools
 * being read-only.
 */

export interface CodeChangeInput {
  /** What to change, in plain language — becomes the goal description. */
  readonly task: string;
  /** The jailed root `WorkspaceEnvironment` confines file and shell access
   *  to. Must be a real, disposable directory — never point this at a
   *  checkout you aren't prepared to have written to. */
  readonly workspaceRoot: string;
  /** Shell command, run from `workspaceRoot`, whose exit code gates
   *  completion — "the tests pass" as evidence, not "the model said so".
   *  Default `npm test --silent`. */
  readonly verifyCommand?: string;
  /** Overrides for the declared budget. */
  readonly budget?: { maxTotalTokens?: number; maxCostUsd?: number };
  /** Iteration cap — coding tasks run longer loops than a single
   *  extraction or categorization call. Default 25. */
  readonly maxIterations?: number;
}

export interface CodeChangeResult {
  /** The model's own summary of what it changed and why — a claim the
   *  verifier's command exit code is what actually backs. */
  readonly summary: string;
}

const SYSTEM_INSTRUCTIONS = [
  'You are a coding agent operating on a real workspace.',
  'Read before you write. Prefer the smallest change that satisfies the task.',
  'Run the verify command yourself before claiming completion — a claim',
  "without evidence will be rejected by the runtime's own verifier.",
].join(' ');

function codeChangeGoal(input: CodeChangeInput): Goal {
  return createGoal({
    description: input.task,
    successCriteria: [
      'the workspace change satisfies the task',
      `\`${input.verifyCommand ?? 'npm test --silent'}\` exits 0`,
    ],
  });
}

export const codeChangeTemplate: OutcomeTemplate<CodeChangeInput> = {
  id: 'code-change',
  version: '0.1.0',
  outcome: {
    description: 'Make a change to a real codebase and prove it by running the project\'s own check command',
    expectedCostUsd: { typical: 0.05, max: 1.00 },
    successThreshold: 'the configured verify command exits 0 (default `npm test --silent`) — ' +
      'a passing command on an unchanged workspace is a verifier gap this template does not ' +
      'close on its own; pick a verify command that actually exercises the task.',
  },

  build(input, deps: TemplateDeps): AgentDeps {
    const env = new WorkspaceEnvironment({ root: input.workspaceRoot });
    const tools = codingTools(env);
    const registry = new ToolRegistry();
    for (const tool of tools) registry.register(tool);

    const specs = tools.map(toToolSpec);
    const tier = (m: TemplateDeps['cheap']) =>
      new ReActReasoner(m, { tools: specs, instructions: SYSTEM_INSTRUCTIONS });
    const reasoner = deps.strong !== undefined
      ? new EscalatingReasoner([tier(deps.cheap), tier(deps.strong)], { escalateAfterFailures: deps.escalateAfter ?? 2 })
      : tier(deps.cheap);

    return {
      spec: createAgentSpec({ name: `tpl:${codeChangeTemplate.id}`, goal: codeChangeGoal(input) }),
      reasoner,
      executor: new CompositeExecutor({ 'env://': env, 'tool://': new ToolExecutor(registry) }),
      // Destructive tools (delete_file, run_command) need a human; a write
      // or destructive action triggered by content the agent just read
      // (not the operator's own task) is denied outright, not just gated —
      // the same prompt-injection shape production-agent defends against.
      policy: createToolPolicy(registry, {
        approvalFor: ['destructive'],
        denyExternalTriggered: ['destructive', 'write'],
        unknownTool: 'deny',
      }),
      grants: ['fs.read', 'fs.write', 'fs.delete', 'shell.exec'],
      verifier: atCompletion(new CommandVerifier(input.verifyCommand ?? 'npm test --silent', { cwd: input.workspaceRoot })),
      maxIterations: input.maxIterations ?? 25,
      budgets: input.budget ?? { maxTotalTokens: 200_000, maxCostUsd: 1.00 },
    };
  },
};
