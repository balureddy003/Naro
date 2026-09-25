import type { RunEvent } from '@naro/client';
import { actionLabel } from './copy.ts';

/**
 * Run journal → transcript view model. Pure shaping, zero DOM — the same
 * function the tests exercise; views render `TranscriptItem`s and nothing
 * else, so "what does the chat show" is a data question, testable
 * without a browser.
 *
 * A run IS the conversation: one goal, one transcript of chips (tool
 * calls), approval cards, notes, and a final message. A follow-up
 * message is a new run — the multi-turn question PRD-006 flags as open
 * is answered here the simplest honest way: each submission is a new
 * run, listed as its own conversation.
 */

export interface ChipItem {
  readonly kind: 'chip';
  readonly actionId: string;
  readonly capability: string;
  readonly target: string;
  readonly label: string;
  status: 'pending' | 'done' | 'denied' | 'failed';
  policy: 'permitted' | 'approved' | 'denied' | 'unresolved';
  verification?: { ok: boolean; verifier?: string; reason?: string };
  observation?: { success: boolean; error?: string };
  /** Chain hash of the event that settled this action — the evidence
   *  expand's "same record naro verify prints" link. */
  hash?: string;
  readonly seq: number;
}

export interface ApprovalItem {
  readonly kind: 'approval';
  /** The approval id for answering — attached by the view from
   *  GET /approvals (journal events don't carry it). */
  approvalId?: string;
  readonly question: string;
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
  by?: string;
  /** What was approved — stays visible after resolution ("Confirmed
   *  $2,847.00 — recorded just now"), per the PRD's
   *  resolve-in-place-not-dismiss rule. */
  answerText?: string;
  readonly seq: number;
}

export interface MessageItem {
  readonly kind: 'message';
  readonly role: 'assistant' | 'system' | 'user';
  readonly text: string;
  readonly result?: unknown;
  readonly seq: number;
}

export type TranscriptItem = ChipItem | ApprovalItem | MessageItem;

export interface Transcript {
  readonly items: readonly TranscriptItem[];
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'unknown';
  readonly result?: unknown;
  readonly error?: string;
  /** Latest model-usage totals from the journal — the cost story
   *  (cheap-tier vs frontier) is real data, so the footer shows it. */
  usage?: { totalTokens: number; costUsd: number };
}

export function transcriptFromEvents(events: readonly RunEvent[]): Transcript {
  const items: TranscriptItem[] = [];
  const chips = new Map<string, ChipItem>();
  const approvals = new Map<number, ApprovalItem>();
  let status: Transcript['status'] = 'unknown';
  let result: unknown;
  let error: string | undefined;
  let usage: Transcript['usage'];
  let lastChip: ChipItem | undefined;

  const findChip = (actionId: string | undefined): ChipItem | undefined =>
    actionId !== undefined ? chips.get(actionId) : lastChip;

  for (const e of events) {
    const d = e.data as Record<string, unknown>;
    switch (e.type) {
      case 'action.requested': {
        const a = d['action'] as { id: string; capability: string; target: string; input?: unknown };
        let label = actionLabel(a.capability, a.target);
        // A delegation names its target agent in the input — label the
        // chip with who the work went to, not the mechanism.
        if (a.target === 'tool://delegate' && a.input !== null && typeof a.input === 'object') {
          const agent = (a.input as { agent?: unknown }).agent;
          if (typeof agent === 'string') label = `Delegated to ${agent}`;
        }
        const chip: ChipItem = {
          kind: 'chip', actionId: a.id, capability: a.capability, target: a.target,
          label, status: 'pending',
          policy: 'unresolved', seq: e.seq,
        };
        chips.set(a.id, chip);
        lastChip = chip;
        items.push(chip);
        break;
      }
      case 'action.permitted': {
        const chip = findChip((d['action'] as { id?: string } | undefined)?.id);
        if (chip) { chip.policy = d['policy'] === undefined ? 'permitted' : 'approved'; }
        break;
      }
      case 'action.denied': {
        const a = d['action'] as { id: string; capability: string; target: string } | undefined;
        const chip = a !== undefined ? findChip(a.id) : lastChip;
        if (chip) {
          chip.policy = 'denied';
          chip.status = 'denied';
          chip.observation = { success: false, ...(typeof d['reason'] === 'string' && { error: d['reason'] }) };
        } else if (a !== undefined) {
          // Denied before a requested event surfaced — still a first-class
          // transcript row; hiding a denial would hide the gate.
          const denied: ChipItem = {
            kind: 'chip', actionId: a.id, capability: a.capability, target: a.target,
            label: actionLabel(a.capability, a.target), status: 'denied',
            policy: 'denied',
            observation: { success: false, ...(typeof d['reason'] === 'string' && { error: d['reason'] }) },
            seq: e.seq,
          };
          chips.set(a.id, denied);
          lastChip = denied;
          items.push(denied);
        }
        break;
      }
      case 'action.completed': {
        const a = d['action'] as { id: string };
        const obs = d['observation'] as { success: boolean; error?: string } | undefined;
        const chip = findChip(a.id);
        if (chip) {
          chip.status = obs?.success === false ? 'failed' : 'done';
          chip.hash = e.hash;
          if (obs) chip.observation = { success: obs.success, ...(obs.error !== undefined && { error: obs.error }) };
        }
        break;
      }
      case 'verification.completed': {
        const v = { ok: d['ok'] === true, verifier: d['verifier'] as string | undefined, reason: d['reason'] as string | undefined };
        // Attach to the most recent chip — goal-level verification lands
        // after the last action; the final message carries its own state.
        if (lastChip) lastChip.verification = v;
        break;
      }
      case 'human.approval.requested': {
        const item: ApprovalItem = {
          kind: 'approval',
          question: typeof d['question'] === 'string' ? d['question'] : 'Needs your answer before continuing',
          status: 'pending', seq: e.seq,
        };
        approvals.set(e.seq, item);
        items.push(item);
        break;
      }
      case 'human.approval.received': {
        const approved = d['approved'] === true;
        // Resolve the newest still-pending card — answers arrive in order.
        const pending = [...approvals.values()].find((x) => x.status === 'pending');
        if (pending) {
          pending.status = approved ? 'approved' : 'rejected';
          if (typeof d['by'] === 'string') pending.by = d['by'];
        }
        break;
      }
      case 'replan.triggered':
        items.push({ kind: 'message', role: 'system', text: 'Re-checking that and trying again…', seq: e.seq });
        break;
      case 'agent.resumed':
        items.push({ kind: 'message', role: 'system', text: 'Resumed from a checkpoint.', seq: e.seq });
        break;
      case 'model.usage': {
        const t = d['totals'] as { totalTokens?: number; costUsd?: number } | undefined;
        if (t !== undefined) usage = { totalTokens: t.totalTokens ?? 0, costUsd: t.costUsd ?? 0 };
        break;
      }
      case 'agent.paused':
        status = 'paused';
        break;
      case 'agent.cancelled':
        status = 'cancelled';
        items.push({ kind: 'message', role: 'system', text: 'Stopped.', seq: e.seq });
        break;
      case 'agent.failed':
        status = 'failed';
        error = typeof d['error'] === 'string' ? d['error'] : 'Something went wrong';
        items.push({ kind: 'message', role: 'system', text: error, seq: e.seq });
        break;
      case 'agent.completed':
        status = 'completed';
        result = d['result'];
        if (d['usage'] !== undefined) {
          const u = d['usage'] as { totalTokens?: number; costUsd?: number };
          usage = { totalTokens: u.totalTokens ?? 0, costUsd: u.costUsd ?? 0 };
        }
        items.push({ kind: 'message', role: 'assistant', text: 'Done.', result: d['result'], seq: e.seq });
        break;
      default:
        break; // reasoning.started, model.usage, context.retrieved — engine noise, not conversation
    }
  }
  if (status === 'unknown') status = 'running';
  return { items, status, ...(result !== undefined && { result }), ...(error !== undefined && { error }), ...(usage !== undefined && { usage }) };
}

/** Attach the real approval id (from GET /approvals) onto its pending
 *  card — matching by question, falling back to the sole pending card. */
export function attachApprovalId(
  transcript: Transcript,
  pending: readonly { id: string; question: string }[],
): void {
  for (const item of transcript.items) {
    if (item.kind !== 'approval' || item.status !== 'pending') continue;
    const exact = pending.find((p) => p.question === item.question);
    const sole = pending.length === 1 ? pending[0] : undefined;
    const match = exact ?? sole;
    if (match) (item as { approvalId?: string }).approvalId = match.id;
  }
}
