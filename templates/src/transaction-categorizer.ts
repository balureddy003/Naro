import { createAgentSpec, createGoal, type Goal, type Verifier } from '@naro/core';
import { allOf } from '@naro/policy';
import { EscalatingReasoner, ReActReasoner, toToolSpec } from '@naro/reasoning';
import type { AgentDeps } from '@naro/runtime';
import { createToolPolicy, ToolExecutor, ToolRegistry, type Tool } from '@naro/tools';
import { atCompletion, PredicateVerifier } from '@naro/verification';
import type { OutcomeTemplate, TemplateDeps } from './template.ts';

/**
 * Transaction categorizer — PRD-002's reference template: classify one
 * bank/card transaction into the business's own chart of accounts.
 *
 * Why it ships first: the verifier is objective and automatable — the
 * answer is either in the allowed set or it isn't — which makes it the
 * cleanest place to prove PRD-001's cost claim with a real benchmark
 * before anything customer-facing exists.
 */

export interface CategorizeInput {
  readonly transaction: {
    readonly description: string;
    readonly amount: number;
    readonly currency?: string;
    readonly date?: string;
  };
  /** The business's chart of accounts — the only legal answers. */
  readonly categories: readonly string[];
  /** Labeled history — the grounding the model is expected to consult. */
  readonly history?: readonly { description: string; category: string }[];
  /** Below this self-reported confidence the answer fails verification,
   *  driving escalation. Default 0.7; only applies when the model
   *  reports confidence (object results). */
  readonly confidenceFloor?: number;
  /** Overrides for the declared budget — a business that wants a tighter
   *  cap sets it here; the declared `outcome` is the honest default. */
  readonly budget?: { maxTotalTokens?: number; maxCostUsd?: number };
}

export interface CategorizeResult {
  readonly category: string;
  readonly confidence?: number;
}

/** The grant every template tool requires — least privilege made visible. */
export const CATEGORIZE_GRANT = 'finance.categorize';

function templateTools(input: CategorizeInput): readonly Tool[] {
  const history = input.history ?? [];
  return [
    {
      name: 'list_categories',
      description: 'List the allowed categories — the only legal answers.',
      inputSchema: { type: 'object', properties: {} },
      permissions: [CATEGORIZE_GRANT],
      sideEffects: 'read',
      execute: () => Promise.resolve([...input.categories]),
    },
    {
      name: 'lookup_history',
      description: 'Find past transactions similar to a query — how similar vendors were categorized before.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Vendor or description text to match' } },
        required: ['query'],
      },
      permissions: [CATEGORIZE_GRANT],
      sideEffects: 'read',
      execute: (raw) => {
        const { query } = raw as { query: string };
        const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
        const matches = history
          .map((h) => ({ ...h, score: terms.filter((t) => h.description.toLowerCase().includes(t)).length }))
          .filter((m) => m.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(({ description, category }) => ({ description, category }));
        return Promise.resolve(matches);
      },
    },
  ];
}

/** The verifier IS the template (PRD-002 goal 2): membership + confidence
 *  floor. A failed floor is a verification failure — which is exactly
 *  what makes EscalatingReasoner reach for the stronger tier. */
export function categorizerVerifier(input: CategorizeInput): Verifier {
  const floor = input.confidenceFloor ?? 0.7;
  const allowed = new Map(input.categories.map((c) => [c.trim().toLowerCase(), c]));
  return atCompletion(new PredicateVerifier('category-membership', ({ result }: { result?: unknown }) => {
    // Accept "Meals & Entertainment" or {"category": "…", "confidence": 0.9}.
    let parsed: unknown = result;
    if (typeof result === 'string') {
      const text = result.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }
    const category = typeof parsed === 'object' && parsed !== null
      ? (parsed as { category?: unknown }).category
      : parsed;
    const confidence = typeof parsed === 'object' && parsed !== null
      ? (parsed as { confidence?: unknown }).confidence
      : undefined;
    if (typeof category !== 'string') {
      return { ok: false, reason: 'result is not a category string or {category, confidence} object' };
    }
    const canonical = allowed.get(category.trim().toLowerCase());
    if (canonical === undefined) {
      return { ok: false, reason: `'${category}' is not in the allowed set (${input.categories.length} categories)` };
    }
    if (typeof confidence === 'number' && confidence < floor) {
      return { ok: false, reason: `confidence ${confidence} below floor ${floor}` };
    }
    return { ok: true, evidence: { category: canonical, ...(confidence !== undefined && { confidence }) } };
  }));
}

function categorizeGoal(input: CategorizeInput): Goal {
  const t = input.transaction;
  return createGoal({
    description:
      `Categorize this transaction into exactly one category from the allowed set.\n\n` +
      `Transaction: ${JSON.stringify({ description: t.description, amount: t.amount, currency: t.currency ?? 'USD', date: t.date })}\n` +
      `Allowed categories: ${input.categories.join(', ')}\n\n` +
      `Use lookup_history to ground the answer in past categorizations when helpful.\n` +
      `Answer with either the category name alone, or {"category": "...", "confidence": 0-1}.`,
    successCriteria: [
      'category is a member of the allowed set',
      `confidence >= ${input.confidenceFloor ?? 0.7} when reported`,
    ],
  });
}

export const transactionCategorizer: OutcomeTemplate<CategorizeInput> = {
  id: 'transaction-categorizer',
  version: '0.1.0',
  outcome: {
    description: 'Categorize a bank/card transaction into a fixed chart-of-accounts list',
    expectedCostUsd: { typical: 0.001, max: 0.02 },
    successThreshold: 'category ∈ allowed set (verified); confidence ≥ floor when self-reported',
  },

  build(input, deps: TemplateDeps): AgentDeps {
    const registry = new ToolRegistry();
    const tools = [...templateTools(input), ...(deps.extraTools ?? [])];
    for (const tool of tools) registry.register(tool);
    // The template owns strategy + tool wiring — each tier is a ReAct
    // reasoner built over the caller's model with THIS template's tools.
    const specs = tools.map(toToolSpec);
    const tier = (m: TemplateDeps['cheap']) => new ReActReasoner(m, { tools: specs });
    const reasoner = deps.strong !== undefined
      ? new EscalatingReasoner([tier(deps.cheap), tier(deps.strong)], { escalateAfterFailures: deps.escalateAfter ?? 2 })
      : tier(deps.cheap);
    return {
      spec: createAgentSpec({ name: `tpl:${transactionCategorizer.id}`, goal: categorizeGoal(input) }),
      reasoner,
      executor: new ToolExecutor(registry),
      // Least privilege: the template's read-only tools and nothing else.
      // otherwise:'deny' closes every non-tool target; the tools' own
      // permissions gate on the finance.categorize grant below.
      policy: allOf(createToolPolicy(registry, { otherwise: 'deny' })),
      grants: [CATEGORIZE_GRANT, ...(deps.extraGrants ?? [])],
      verifier: categorizerVerifier(input),
      budgets: input.budget ?? { maxTotalTokens: 20_000, maxCostUsd: 0.02 },
    };
  },
};
