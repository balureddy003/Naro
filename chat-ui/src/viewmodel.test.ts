import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachApprovalId, transcriptFromEvents } from './viewmodel.ts';
import type { RunEvent } from '@naro/client';

/** Minimal RunEvent factory — only the fields the viewmodel reads. */
function ev(seq: number, type: string, data: Record<string, unknown> = {}, hash?: string): RunEvent {
  return { id: `e${seq}`, type, seq, at: seq, agentId: 'a1', goalId: 'g1', runId: 'r1', data, ...(hash !== undefined && { hash }) };
}

test('a tool call becomes one expandable chip with policy + verification', () => {
  const t = transcriptFromEvents([
    ev(1, 'goal.started', { goal: {} }),
    ev(2, 'action.requested', { action: { id: 'a1', capability: 'get_document', target: 'invoice_2847.pdf' } }),
    ev(3, 'action.permitted', { action: { id: 'a1', capability: 'get_document', target: 'invoice_2847.pdf' } }),
    ev(4, 'action.completed', { action: { id: 'a1' }, observation: { success: true } }, 'abc123def456'),
    ev(5, 'verification.completed', { ok: true, verifier: 'schema' }),
    ev(6, 'agent.completed', { result: { total: 100 } }),
  ]);
  assert.equal(t.status, 'completed');
  const chips = t.items.filter((i) => i.kind === 'chip');
  assert.equal(chips.length, 1);
  const chip = chips[0]!;
  assert.equal(chip.status, 'done');
  assert.equal(chip.policy, 'permitted');
  assert.equal(chip.verification?.ok, true);
  assert.equal(chip.hash, 'abc123def456');
  // Jargon-free label — "Read invoice_2847.pdf", never "action.completed".
  assert.equal(chip.label, 'Read invoice_2847.pdf');
});

test('a denied action is a first-class chip, not hidden', () => {
  const t = transcriptFromEvents([
    ev(1, 'action.requested', { action: { id: 'a1', capability: 'tool:delete_ledger', target: 'ledger' } }),
    ev(2, 'action.denied', { action: { id: 'a1', capability: 'tool:delete_ledger', target: 'ledger' }, reason: 'no grant' }),
    ev(3, 'agent.failed', { error: 'policy denied' }),
  ]);
  const chip = t.items.find((i) => i.kind === 'chip')!;
  assert.equal(chip.policy, 'denied');
  assert.equal(chip.status, 'denied');
  assert.equal(t.status, 'failed');
});

test('an approval request renders pending, then resolves on received', () => {
  const t = transcriptFromEvents([
    ev(1, 'human.approval.requested', { question: 'Confirm the total $2,847.00?' }),
    ev(2, 'human.approval.received', { approved: true, by: 'owner' }),
    ev(3, 'agent.completed', { result: 'ok' }),
  ]);
  const card = t.items.find((i) => i.kind === 'approval')!;
  assert.equal(card.status, 'approved');
  assert.equal(card.by, 'owner');
});

test('replan + cancelled surface as plain-language states', () => {
  const t = transcriptFromEvents([
    ev(1, 'replan.triggered', { reason: 'schema mismatch' }),
    ev(2, 'agent.cancelled', { reason: 'operator halt', by: 'admin' }),
  ]);
  assert.equal(t.status, 'cancelled');
  const texts = t.items.filter((i) => i.kind === 'message').map((m) => (m as { text: string }).text);
  assert.ok(texts.some((x) => x.includes('Re-checking')));
  assert.ok(texts.some((x) => x === 'Stopped.'));
});

test('attachApprovalId pairs the pending card with its real id', () => {
  const t = transcriptFromEvents([
    ev(1, 'human.approval.requested', { question: 'Approve post to ledger?' }),
  ]);
  attachApprovalId(t, [{ id: 'appr_1', question: 'Approve post to ledger?' }]);
  const card = t.items.find((i) => i.kind === 'approval')! as { approvalId?: string };
  assert.equal(card.approvalId, 'appr_1');
});
