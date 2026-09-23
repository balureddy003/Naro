import { createAgentSpec, createGoal, type Goal, type Verifier } from '@naro/core';
import { allOf } from '@naro/policy';
import { EscalatingReasoner, ReActReasoner, toToolSpec } from '@naro/reasoning';
import type { AgentDeps } from '@naro/runtime';
import { createToolPolicy, ToolExecutor, ToolRegistry, type JsonSchema, type Tool } from '@naro/tools';
import { allOf as verifyAllOf, atCompletion, PredicateVerifier, SchemaVerifier } from '@naro/verification';
import type { OutcomeTemplate, TemplateDeps } from './template.ts';

/**
 * Invoice/receipt extractor — PRD-002's second template: pull vendor,
 * date, line items, and total out of a document's extracted text.
 *
 * Verifier shape per the PRD: schema validation (the answer must BE
 * an invoice-shaped object) + arithmetic check (the line items must
 * add up to the claimed total). Neither is optional — a JSON blob that
 * doesn't reconcile is a failed extraction, not a confident one.
 */

export interface InvoiceExtractInput {
  /** The document's extracted text — OCR output or a text rendering.
   *  v1 is text-only; scanned images belong to a vision-capable tier. */
  readonly document: string;
  /** Overrides for the declared budget. */
  readonly budget?: { maxTotalTokens?: number; maxCostUsd?: number };
}

export interface InvoiceLineItem {
  readonly description: string;
  readonly quantity?: number;
  readonly unitPrice?: number;
  readonly amount: number;
}

export interface InvoiceExtractResult {
  readonly vendor: string;
  readonly date: string;
  readonly currency?: string;
  readonly lineItems: readonly InvoiceLineItem[];
  readonly subtotal?: number;
  readonly tax?: number;
  readonly total: number;
}

export const INVOICE_GRANT = 'finance.invoice';

const INVOICE_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['vendor', 'date', 'lineItems', 'total'],
  properties: {
    vendor: { type: 'string' },
    date: { type: 'string' },
    currency: { type: 'string' },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description', 'amount'],
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number' },
          amount: { type: 'number' },
        },
      },
    },
    subtotal: { type: 'number' },
    tax: { type: 'number' },
    total: { type: 'number' },
  },
};

/** Loose-parse the model's completion claim into an object, tolerating
 *  code fences and prose around the JSON. */
export function parseJsonResult(result: unknown): Record<string, unknown> | undefined {
  if (typeof result === 'object' && result !== null) return result as Record<string, unknown>;
  if (typeof result !== 'string') return undefined;
  const text = result.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; } catch { return undefined; }
}

function templateTools(input: InvoiceExtractInput): readonly Tool[] {
  return [
    {
      name: 'get_document',
      description: 'Return the full extracted text of the invoice/receipt being processed.',
      inputSchema: { type: 'object', properties: {} },
      permissions: [INVOICE_GRANT],
      sideEffects: 'read',
      execute: () => Promise.resolve(input.document),
    },
    {
      name: 'compute_total',
      description: 'Sum a list of amounts exactly — use it to check your extracted line items before answering.',
      inputSchema: {
        type: 'object',
        properties: { amounts: { type: 'array', items: { type: 'number' } } },
        required: ['amounts'],
      },
      permissions: [INVOICE_GRANT],
      sideEffects: 'read',
      execute: (raw) => {
        const { amounts } = raw as { amounts: number[] };
        return Promise.resolve({ sum: amounts.reduce((a, b) => a + b, 0) });
      },
    },
  ];
}

/** Run `v` against the JSON-parsed result — models answer with JSON
 *  *text*, and a schema check on the string itself is a false negative. */
export function parseFirst(v: Verifier): Verifier {
  return {
    id: v.id,
    verify: (input) => v.verify({ ...input, result: parseJsonResult(input.result) }),
  };
}

/** Schema + arithmetic: the document must parse, and its numbers must reconcile. */
export function invoiceVerifier(): Verifier {
  const TOLERANCE = 0.02; // rounding noise on currency amounts
  return atCompletion(verifyAllOf('invoice-extraction',
    parseFirst(new SchemaVerifier(INVOICE_SCHEMA)),
    new PredicateVerifier('invoice-arithmetic', ({ result }: { result?: unknown }) => {
      const inv = parseJsonResult(result) as unknown as InvoiceExtractResult | undefined;
      if (!inv) return { ok: false, reason: 'result is not parseable as an invoice object' };
      if (!inv.vendor?.trim() || !inv.date?.trim()) {
        return { ok: false, reason: 'vendor and date must be non-empty' };
      }
      const items = inv.lineItems ?? [];
      if (items.length === 0) return { ok: false, reason: 'lineItems is empty' };
      const itemsSum = items.reduce((a, i) => a + i.amount, 0);
      // Per-item consistency when quantity × unitPrice are both present.
      for (const item of items) {
        if (item.quantity !== undefined && item.unitPrice !== undefined
          && Math.abs(item.quantity * item.unitPrice - item.amount) > TOLERANCE) {
          return { ok: false, reason: `line item '${item.description}': ${item.quantity} × ${item.unitPrice} ≠ ${item.amount}` };
        }
      }
      // Reconcile: prefer subtotal+tax → total when present; otherwise items → total.
      const claimed = inv.total;
      const base = inv.subtotal !== undefined ? inv.subtotal + (inv.tax ?? 0) : itemsSum;
      if (Math.abs(base - claimed) > TOLERANCE) {
        return {
          ok: false,
          reason: `arithmetic does not reconcile: ${inv.subtotal !== undefined ? `subtotal ${inv.subtotal} + tax ${inv.tax ?? 0}` : `line items sum ${itemsSum.toFixed(2)}`} ≠ total ${claimed}`,
        };
      }
      return { ok: true, evidence: { vendor: inv.vendor, total: claimed, items: items.length } };
    }),
  ));
}

function extractGoal(): Goal {
  return createGoal({
    description:
      `Extract the invoice fields from the document (call get_document to read it).\n` +
      `Answer with ONLY a JSON object: {"vendor","date","currency"?,"lineItems":[{"description","quantity"?,"unitPrice"?,"amount"}],"subtotal"?,"tax"?,"total"}.\n` +
      `The line items must add up to the total — use compute_total to check before answering.`,
    successCriteria: ['result parses as the invoice schema', 'line items reconcile with the total'],
  });
}

export const invoiceExtractor: OutcomeTemplate<InvoiceExtractInput> = {
  id: 'invoice-extractor',
  version: '0.1.0',
  outcome: {
    description: 'Pull vendor, date, line items, and total from a document',
    expectedCostUsd: { typical: 0.002, max: 0.05 },
    successThreshold: 'schema-valid AND arithmetically reconciled (verified)',
  },

  build(input, deps: TemplateDeps): AgentDeps {
    const registry = new ToolRegistry();
    const tools = templateTools(input);
    for (const tool of tools) registry.register(tool);
    const specs = tools.map(toToolSpec);
    const tier = (m: TemplateDeps['cheap']) => new ReActReasoner(m, { tools: specs });
    const reasoner = deps.strong !== undefined
      ? new EscalatingReasoner([tier(deps.cheap), tier(deps.strong)], { escalateAfterFailures: deps.escalateAfter ?? 2 })
      : tier(deps.cheap);
    return {
      spec: createAgentSpec({ name: `tpl:${invoiceExtractor.id}`, goal: extractGoal() }),
      reasoner,
      executor: new ToolExecutor(registry),
      policy: allOf(createToolPolicy(registry, { otherwise: 'deny' })),
      grants: [INVOICE_GRANT],
      verifier: invoiceVerifier(),
      budgets: input.budget ?? { maxTotalTokens: 40_000, maxCostUsd: 0.05 },
    };
  },
};
