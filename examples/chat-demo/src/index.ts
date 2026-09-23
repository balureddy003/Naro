/**
 * chat-demo — a `naro serve` module wiring the PRD-002 outcome templates
 * to the chat UI (PRD-006). One deployment, two template objects:
 *
 *   npx naro serve examples/chat-demo/src/index.ts \
 *     --principals-store ./data/principals.db --approvals ./data/approvals.db
 *
 * then open /chat. `info.template` picks which template runs — the same
 * field the chat composer sends; `specName` lands as `tpl:<id>` so runs
 * group under their template in the sidebar.
 *
 * Vendor-history lookups are gated behind a human — an owner confirms
 * before the agent reads financial records, which is what makes the
 * approval card show up in the transcript.
 */
import type { Action, Goal, PolicyContext } from '@naro/core';
import { AgentRunner, SqliteApprovalBridge } from '@naro/runtime';
import { MockModel, type ChatRequest, type ChatResponse, type Model } from '@naro/model';
import { ollamaCheapTier } from '@naro/adapter-openai';
import { invoiceExtractor, transactionCategorizer, type CategorizeInput } from '@naro/templates';

// The shared approvals queue — the same durable bridge serve exposes at
// /approvals, so the chat card's answer lands here.
const approvals = new SqliteApprovalBridge(
  process.env['NARO_APPROVALS_DB'] ?? './data/approvals.db',
  { pollMs: 50 },
);

/** Cheap tier: the verified local model (qwen2.5:3b via Ollama), or a
 *  scripted MockModel when NARO_DEMO_MOCK=1 — demo without a GPU. */
function model(): Model {
  if (process.env['NARO_DEMO_MOCK'] === '1') {
    return new MockModel({
      respond: (req: ChatRequest): ChatResponse => {
        const sawTool = req.messages.some((m) => m.role === 'tool');
        if (!sawTool) {
          return {
            message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'lookup_history', arguments: { query: 'vendor' } }] },
            finishReason: 'tool-calls',
          };
        }
        return { message: { role: 'assistant', content: 'Office Supplies' }, finishReason: 'stop' };
      },
    });
  }
  return ollamaCheapTier({ model: process.env['NARO_OLLAMA_MODEL'] ?? 'qwen2.5:3b' }).model;
}

/** Loose parse of a free-text categorizer request — the demo's input
 *  boundary; a real deployment would carry structured transaction data. */
function parseTransaction(description: string): CategorizeInput {
  const amount = /\$?(\d+(?:\.\d{2})?)/.exec(description)?.[1];
  return {
    transaction: {
      description,
      amount: amount !== undefined ? Number(amount) : 0,
      currency: 'USD',
      date: new Date().toISOString().slice(0, 10),
    },
    categories: ['Meals & Entertainment', 'Office Supplies', 'Travel', 'Software & Subscriptions'],
    history: [
      { description: 'STAPLES #441', category: 'Office Supplies' },
      { description: 'UBER *TRIP 1021', category: 'Travel' },
      { description: 'MAILCHIMP MONTHLY', category: 'Software & Subscriptions' },
    ],
  };
}

export const createRunner = (goal: Goal, info?: { template?: string }) => {
  const template = info?.template ?? 'transaction-categorizer';
  const build = template === 'invoice-extractor'
    ? () => invoiceExtractor.build({ document: goal.description }, { cheap: model() })
    : () => transactionCategorizer.build(parseTransaction(goal.description), { cheap: model() });
  const deps = build();
  return new AgentRunner({
    ...deps,
    human: approvals,
    policy: {
      evaluate: (action: Action, ctx: PolicyContext) => {
        // The deployment's own rule layered on the template's policy:
        // reading vendor history touches financial records — a person
        // signs off. This is what produces the approval card in /chat.
        if (action.capability === 'tool.invoke' && (action.target === 'tool://lookup_history' || action.target === 'tool://get_document')) {
          return Promise.resolve({ decision: 'require_approval' as const, reason: 'financial-records access needs a person to confirm' });
        }
        return deps.policy.evaluate(action, ctx);
      },
    },
  });
};

// The manifest the sidebar lists — the deployment's declared templates.
export const chatTemplates = [
  { id: 'transaction-categorizer', name: 'Transaction categorizer', icon: 'TC', tagline: 'Sorts expenses into your chart of accounts', configured: true },
  { id: 'invoice-extractor', name: 'Invoice extractor', icon: 'IE', tagline: 'Reads invoices into structured fields', configured: true },
];
