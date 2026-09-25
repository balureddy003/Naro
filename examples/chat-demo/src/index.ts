/**
 * chat-demo — a `naro serve` module wiring the PRD-002 outcome templates
 * to the chat UI (PRD-006), plus the three capabilities the UI only
 * earns by being real:
 *
 *   memory      — `remember`/`recall_category` tools on a SQLite
 *                 MemoryStore; the categorizer writes verified
 *                 vendor→category mappings and reads them back on later
 *                 runs (a repeated vendor skips the gated history lookup
 *                 entirely — memory visibly changes behavior).
 *   delegation  — an InMemoryAgentBus serving a read-only
 *                 `vendor-researcher` child agent; `delegationTool` hands
 *                 it a goal over `info.submit`, so the child run registers
 *                 and journals under the parent's traceId — `GET
 *                 /runs?traceId=` returns the whole tree.
 *   models      — `modelVerifier` wraps adapter-openai's
 *                 verifyOllamaCapabilities so Settings can show proven
 *                 (not claimed) capabilities. Omitted in mock mode — a
 *                 scripted model has nothing to verify.
 *
 *   npx naro serve examples/chat-demo/src/index.ts \
 *     --principals-store ./data/principals.db --approvals ./data/approvals.db
 */
import { createAgentSpec, type Action, type Goal, type PolicyContext } from '@naro/core';
import { allOf } from '@naro/policy';
import { AgentRunner, SqliteApprovalBridge, type AgentDeps } from '@naro/runtime';
import { MockModel, type ChatRequest, type ChatResponse, type Model, type ToolCall } from '@naro/model';
import { ollamaCheapTier, verifyOllamaCapabilities } from '@naro/adapter-openai';
import { createToolPolicy, ToolExecutor, ToolRegistry, type Tool } from '@naro/tools';
import { ReActReasoner, toToolSpec } from '@naro/reasoning';
import { SqliteMemoryStore } from '@naro/memory';
import { AgentDirectory, delegationTool, InMemoryAgentBus } from '@naro/multiagent';
import { invoiceExtractor, transactionCategorizer, type CategorizeInput } from '@naro/templates';

// The shared approvals queue — the same durable bridge serve exposes at
// /approvals, so the chat card's answer lands here.
const approvals = new SqliteApprovalBridge(
  process.env['NARO_APPROVALS_DB'] ?? './data/approvals.db',
  { pollMs: 50 },
);

/** What the vendor extractor remembers — durable across restarts. */
const memory = new SqliteMemoryStore(process.env['NARO_MEMORY_DB'] ?? './data/memory.db');

function toolCall(name: string, args: Record<string, unknown>): ChatResponse {
  const call: ToolCall = { id: `t_${name}`, name, arguments: args };
  return { message: { role: 'assistant', content: '', toolCalls: [call] }, finishReason: 'tool-calls' };
}

function answer(text: string): ChatResponse {
  return { message: { role: 'assistant', content: text }, finishReason: 'stop' };
}

/**
 * Scripted models for the demo — each role gets its own script keyed off
 * the tool messages already in the request, so the flow is a real ReAct
 * loop, just with a deterministic model.
 *
 * Parent (categorizer):  recall → (hit: answer) / (miss: delegate →
 * lookup_history → remember → answer). The delegated child run and the
 * memory write are real side effects — the script only decides the order.
 */
function demoModel(role: 'parent' | 'researcher'): Model {
  if (process.env['NARO_DEMO_MOCK'] !== '1') return ollamaCheapTier({ model: process.env['NARO_OLLAMA_MODEL'] ?? 'qwen2.5:3b' }).model;
  return new MockModel({
    respond: (req: ChatRequest): ChatResponse => {
      const tools = req.messages.filter((m) => m.role === 'tool');
      // `toolCall()` ids every call t_<name> — the tool message echoes it
      // back as toolCallId, the deterministic thing to branch on.
      const lastId = tools[tools.length - 1]?.toolCallId;
      const rawContent = tools[tools.length - 1]?.content;
      const lastOut = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent ?? '');
      if (role === 'researcher') {
        return tools.length === 0
          ? toolCall('search_vendors', { query: 'vendor' })
          : answer(JSON.stringify({ name: 'Staples', sells: 'office supplies and stationery' }));
      }
      // The vendor the goal names — memory is keyed on the real vendor,
      // so a repeated vendor hits and a new one misses. Honest learning:
      // the demo doesn't fake the difference. Scan every message — the
      // goal text isn't necessarily the first (system prompts precede).
      const goalText = req.messages.map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
      // "Categorize AMZN-MARKETPLACE $89.99" → the vendor is the word
      // after the verb — memory keys on the real vendor name.
      const vendor = /"description":"\w+\s+([\w-]+)/.exec(goalText)?.[1] ?? 'vendor';
      if (tools.length === 0) return toolCall('recall_category', { vendor });
      if (lastId === 't_recall_category' && lastOut.includes('"found":true')) {
        const category = /"category":\s*"([^"]+)"/.exec(lastOut)?.[1] ?? 'Office Supplies';
        return answer(category);
      }
      if (lastId === 't_recall_category') return toolCall('delegate', { agent: 'vendor-researcher', goal: `What does ${vendor} sell?` });
      if (lastId === 't_delegate') return toolCall('lookup_history', { query: 'staples' });
      if (lastId === 't_lookup_history') return toolCall('remember', { vendor, category: 'Office Supplies' });
      return answer('Office Supplies');
    },
  });
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

// ---------- memory tools (deployment-owned, folded in via extraTools) ----------

const recallTool: Tool = {
  name: 'recall_category',
  description: 'Check remembered vendor→category mappings before doing a gated lookup.',
  inputSchema: {
    type: 'object',
    properties: { vendor: { type: 'string', description: 'Vendor name or transaction text' } },
    required: ['vendor'],
  },
  permissions: ['finance.recall'],
  sideEffects: 'read',
  execute: async (raw) => {
    const { vendor } = raw as { vendor: string };
    const hits = await memory.search(vendor.toLowerCase(), 3);
    const hit = hits[0];
    const remembered = hit !== undefined && typeof hit.content === 'object' && hit.content !== null
      ? (hit.content as { category?: string }).category
      : undefined;
    return remembered !== undefined ? { found: true, category: remembered } : { found: false };
  },
};

const rememberTool: Tool = {
  name: 'remember',
  description: 'Remember a vendor→category mapping so future runs answer without a gated lookup.',
  inputSchema: {
    type: 'object',
    properties: {
      vendor: { type: 'string' },
      category: { type: 'string', description: 'Must be one of the allowed categories' },
    },
    required: ['vendor', 'category'],
  },
  permissions: ['finance.remember'],
  sideEffects: 'write',
  execute: async (raw) => {
    const { vendor, category } = raw as { vendor: string; category: string };
    await memory.write({
      key: `vendor:${vendor.toLowerCase()}`,
      content: { vendor, category },
      tier: 'semantic',
      tags: ['vendor', 'category'],
      source: 'tool://remember',
    });
    return { remembered: `${vendor} → ${category}` };
  },
};

// ---------- delegation (ADR 0028: info.submit registers the child) ----------

const bus = new InMemoryAgentBus();
const directory = new AgentDirectory();
directory.register({ id: 'vendor-researcher', name: 'Vendor researcher', capabilities: ['research.lookup'] });

// The launch path serve hands to createRunner — captured once (it is
// server-scoped, not run-scoped) so the bus handler can submit children.
let submit: RunSubmit | undefined;

/** The child agent — read-only vendor research. Deliberately minimal:
 *  one tool, one grant, small budget. Its value is being a real second
 *  run in the same trace, not its answer's sophistication. */
function researcherDeps(goal: Goal): AgentDeps {
  const registry = new ToolRegistry();
  const search: Tool = {
    name: 'search_vendors',
    description: 'Look up what a vendor sells.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    permissions: ['research.read'],
    sideEffects: 'read',
    execute: () => Promise.resolve({ name: 'Staples', sells: 'office supplies and stationery' }),
  };
  registry.register(search);
  return {
    spec: createAgentSpec({ name: 'tpl:vendor-researcher', goal }),
    reasoner: new ReActReasoner(demoModel('researcher'), { tools: [toToolSpec(search)] }),
    executor: new ToolExecutor(registry),
    policy: allOf(createToolPolicy(registry, { otherwise: 'deny' })),
    grants: ['research.read'],
    budgets: { maxTotalTokens: 10_000, maxCostUsd: 0.01 },
  };
}

bus.serve('vendor-researcher', async (msg) => {
  if (submit === undefined) throw new Error('no run submitter — server did not provide info.submit');
  const launched = submit(msg.goal, { template: 'vendor-researcher' });
  const done = await launched.done;
  return done.result ?? { status: done.status, error: done.error };
});

const delegateTool = delegationTool(bus, 'tpl:transaction-categorizer', directory, {
  maxDepth: 1,
  allowedCapabilities: ['tool.invoke'],
});

/**
 * The run-submission hook serve hands to `createRunner` as `info.submit`
 * (ADR 0028) — a module submits a delegated goal through it and the child
 * run registers, journals, and lists under the parent's traceId. Typed
 * inline because the module contract is a structural shape, not a runtime
 * import.
 */
interface RunSubmit {
  (goal: Goal, opts?: { template?: string }): { runId: string; done: Promise<{ status: string; result?: unknown; error?: string }> };
}

// ---------- module contract ----------

export const createRunner = (goal: Goal, info?: { template?: string; submit?: RunSubmit }) => {
  if (info?.submit !== undefined) submit = info.submit;
  const template = info?.template ?? 'transaction-categorizer';

  if (template === 'vendor-researcher') return new AgentRunner(researcherDeps(goal));

  const build = template === 'invoice-extractor'
    ? () => invoiceExtractor.build({ document: goal.description }, { cheap: demoModel('parent') })
    : () => transactionCategorizer.build(parseTransaction(goal.description), {
        cheap: demoModel('parent'),
        extraTools: [recallTool, rememberTool, delegateTool],
        extraGrants: ['finance.recall', 'finance.remember', 'agent.delegate'],
      });
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
// vendor-researcher is deliberately absent: it's a delegation target,
// not a user-facing object — its runs show up under their parent's trace.
export const chatTemplates = [
  { id: 'transaction-categorizer', name: 'Transaction categorizer', icon: 'TC', tagline: 'Sorts expenses into your chart of accounts', configured: true },
  { id: 'invoice-extractor', name: 'Invoice extractor', icon: 'IE', tagline: 'Reads invoices into structured fields', configured: true },
];

// ADR 0028: the module owns which models exist and how they're verified —
// serve stays vendor-neutral and only exposes POST /admin/models/verify.
// Mock mode declares no verifier: a scripted model has nothing to probe.
export const modelVerifier = process.env['NARO_DEMO_MOCK'] === '1'
  ? undefined
  : () => verifyOllamaCapabilities({ model: process.env['NARO_OLLAMA_MODEL'] ?? 'qwen2.5:3b' });
