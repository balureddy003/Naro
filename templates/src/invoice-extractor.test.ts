import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockModel, type ChatRequest, type ChatResponse } from '@naro/model';
import { AgentRunner } from '@naro/runtime';
import { invoiceExtractor, type InvoiceExtractInput } from './invoice-extractor.ts';

const DOC = `INVOICE
Vendor: Acme Office Supply Co.
Date: 2026-01-20
Items:
  Printer paper (2 x $12.50) .......... $25.00
  Ink cartridge, black (1 x $34.00) ... $34.00
Subtotal: $59.00
Tax: $4.72
Total: $63.72`;

const GOOD = JSON.stringify({
  vendor: 'Acme Office Supply Co.', date: '2026-01-20', currency: 'USD',
  lineItems: [
    { description: 'Printer paper', quantity: 2, unitPrice: 12.5, amount: 25 },
    { description: 'Ink cartridge, black', quantity: 1, unitPrice: 34, amount: 34 },
  ],
  subtotal: 59, tax: 4.72, total: 63.72,
});

const INPUT: InvoiceExtractInput = { document: DOC };

/** Script: read the doc, sanity-check the math, then answer. */
function scriptedModel(answer: string): MockModel {
  return new MockModel({
    respond: (req: ChatRequest): ChatResponse => {
      const toolResults = req.messages.filter((m) => m.role === 'tool').length;
      if (toolResults === 0) {
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'get_document', arguments: {} }] }, finishReason: 'tool-calls' };
      }
      if (toolResults === 1) {
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: 't2', name: 'compute_total', arguments: { amounts: [25, 34] } }] }, finishReason: 'tool-calls' };
      }
      return { message: { role: 'assistant', content: answer }, finishReason: 'stop' };
    },
  });
}

test('milestone 3: extraction completes with a schema-valid, arithmetically reconciled invoice', async () => {
  const deps = invoiceExtractor.build(INPUT, { cheap: scriptedModel(GOOD) });
  const result = await new AgentRunner(deps).run();

  assert.equal(result.status, 'completed');
  const parsed = JSON.parse(result.result as string) as { vendor: string; total: number };
  assert.equal(parsed.vendor, 'Acme Office Supply Co.');
  assert.equal(parsed.total, 63.72);

  const v = result.events.find((e) => e.type === 'verification.completed');
  assert.ok(v && (v.data as { ok: boolean }).ok === true, 'verifier must pass on evidence');
});

test('line items that don\'t reconcile with the total fail verification → replan → fix', async () => {
  const bad = JSON.stringify({
    vendor: 'Acme', date: '2026-01-20',
    lineItems: [{ description: 'paper', amount: 25 }],
    total: 63.72, // 25 ≠ 63.72 — the arithmetic check must catch this
  });
  let completions = 0;
  const model = new MockModel({
    respond: (req: ChatRequest): ChatResponse => {
      const toolResults = req.messages.filter((m) => m.role === 'tool').length;
      if (toolResults === 0) return { message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'get_document', arguments: {} }] }, finishReason: 'tool-calls' };
      completions++;
      return { message: { role: 'assistant', content: completions > 1 ? GOOD : bad }, finishReason: 'stop' };
    },
  });
  const result = await new AgentRunner(invoiceExtractor.build(INPUT, { cheap: model })).run();

  assert.equal(result.status, 'completed');
  const failed = result.events.find((e) => e.type === 'verification.completed' && !(e.data as { ok: boolean }).ok);
  assert.ok(failed, 'unreconciled arithmetic must fail verification');
  assert.match((failed!.data as { reason?: string }).reason ?? '', /does not reconcile/);
});

test('schema-invalid answers fail verification — a text blob is not an invoice', async () => {
  let completions = 0;
  const model = new MockModel({
    respond: (req: ChatRequest): ChatResponse => {
      if (!req.messages.some((m) => m.role === 'tool')) {
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'get_document', arguments: {} }] }, finishReason: 'tool-calls' };
      }
      completions++;
      return { message: { role: 'assistant', content: completions > 1 ? GOOD : 'The vendor is Acme, total $63.72.' }, finishReason: 'stop' };
    },
  });
  const result = await new AgentRunner(invoiceExtractor.build(INPUT, { cheap: model })).run();

  assert.equal(result.status, 'completed');
  const failed = result.events.find((e) => e.type === 'verification.completed' && !(e.data as { ok: boolean }).ok);
  assert.ok(failed, 'prose must fail the schema check');
});

test('least privilege: only get_document + compute_total, gated on finance.invoice', async () => {
  const deps = invoiceExtractor.build(INPUT, { cheap: scriptedModel(GOOD) });
  assert.deepEqual(deps.grants, ['finance.invoice']);
  const nosy = new MockModel({
    respond: (): ChatResponse => ({
      message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'send_email', arguments: { to: 'x' } }] },
      finishReason: 'tool-calls',
    }),
  });
  const result = await new AgentRunner(invoiceExtractor.build(INPUT, { cheap: nosy })).run();
  const denied = result.events.find((e) => e.type === 'action.denied');
  assert.ok(denied && /no registered tool/.test((denied.data as { reason?: string }).reason ?? ''));
});
