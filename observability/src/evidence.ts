import { verifyChain, type ChainVerdict, type ModelUsage, type NaroEvent } from '@naro/core';

/** How one action fared end-to-end: gate → execute → observe → verify. */
export interface ActionEvidence {
  readonly actionId: string;
  readonly capability: string;
  /** Gate outcome: policy verdict plus the human-approval path, if taken. */
  readonly policy: 'permitted' | 'approved' | 'denied' | 'unresolved';
  readonly deniedReason?: string;
  readonly executed: boolean;
  readonly observation?: {
    readonly success: boolean;
    readonly kind: string;
    readonly source: string;
    readonly error?: string;
  };
  readonly verification?: {
    readonly ok: boolean;
    readonly verifier?: string;
    readonly reason?: string;
  };
}

/** A run's proof: chain integrity, per-action evidence, and the outcome. */
export interface EvidenceRecord {
  readonly runId?: string;
  readonly agentId?: string;
  readonly events: number;
  readonly chain: ChainVerdict;
  readonly actions: readonly ActionEvidence[];
  readonly goalVerification?: {
    readonly ok: boolean;
    readonly verifier?: string;
    readonly reason?: string;
  };
  readonly outcome?: {
    readonly status: 'completed' | 'failed' | 'cancelled' | 'paused';
    readonly detail?: string;
  };
  readonly usage?: ModelUsage;
  readonly counts: {
    readonly actions: number;
    readonly denied: number;
    readonly verificationFailures: number;
  };
}

/**
 * Correlate a journal into per-action evidence.
 *
 * Pairing rule: `verification.started{subject}` names what the NEXT
 * `verification.completed` judged — `subject` is an action id or the
 * literal 'goal'. The runner emits them in pairs, so the most recent
 * unpaired `started` is always the right antecedent.
 */
export function buildEvidence(events: readonly NaroEvent[]): EvidenceRecord {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const byAction = new Map<string, {
    capability: string; policy: ActionEvidence['policy']; deniedReason?: string;
    executed: boolean; approvalAsked: boolean;
    observation?: ActionEvidence['observation'];
    verification?: ActionEvidence['verification'];
  }>();
  const entry = (id: string) => {
    let e = byAction.get(id);
    if (!e) byAction.set(id, (e = { capability: '?', policy: 'unresolved', executed: false, approvalAsked: false }));
    return e;
  };

  let pendingSubject: string | undefined;
  let goalVerification: EvidenceRecord['goalVerification'];
  let outcome: EvidenceRecord['outcome'];
  let usage: EvidenceRecord['usage'];
  let verificationFailures = 0;

  for (const e of sorted) {
    switch (e.type) {
      case 'action.requested': {
        const x = entry(e.data.action.id);
        x.capability = e.data.action.capability;
        break;
      }
      case 'human.approval.requested':
        if (e.data.action) entry(e.data.action.id).approvalAsked = true;
        break;
      case 'action.denied': {
        const x = entry(e.data.action.id);
        x.policy = 'denied';
        x.deniedReason = e.data.reason ?? 'denied by policy';
        break;
      }
      case 'action.permitted': {
        const x = entry(e.data.action.id);
        x.policy = x.approvalAsked ? 'approved' : 'permitted';
        break;
      }
      case 'action.started':
        entry(e.data.action.id).executed = true;
        break;
      case 'action.completed': {
        const o = e.data.observation;
        entry(e.data.action.id).observation = {
          success: o.success, kind: o.kind, source: o.source,
          ...(o.error !== undefined && { error: o.error }),
        };
        break;
      }
      case 'verification.started':
        pendingSubject = e.data.subject;
        break;
      case 'verification.completed': {
        const v = {
          ok: e.data.ok,
          ...(e.data.verifier !== undefined && { verifier: e.data.verifier }),
          ...(e.data.reason !== undefined && { reason: e.data.reason }),
        };
        if (!v.ok) verificationFailures++;
        if (pendingSubject === 'goal') goalVerification = v;
        else if (pendingSubject !== undefined) entry(pendingSubject).verification = v;
        pendingSubject = undefined;
        break;
      }
      case 'agent.completed':
        outcome = { status: 'completed' };
        usage = e.data.usage;
        break;
      case 'agent.failed':
        outcome = { status: 'failed', detail: e.data.error };
        usage = e.data.usage;
        break;
      case 'agent.cancelled':
        outcome = { status: 'cancelled', ...(e.data.reason !== undefined && { detail: e.data.reason }) };
        usage = e.data.usage;
        break;
      case 'agent.paused':
        outcome = { status: 'paused', ...(e.data.reason !== undefined && { detail: e.data.reason }) };
        break;
    }
  }

  const actions: ActionEvidence[] = [...byAction.entries()].map(([actionId, x]) => ({
    actionId, capability: x.capability, policy: x.policy,
    ...(x.deniedReason !== undefined && { deniedReason: x.deniedReason }),
    executed: x.executed,
    ...(x.observation !== undefined && { observation: x.observation }),
    ...(x.verification !== undefined && { verification: x.verification }),
  }));

  return {
    ...(sorted[0] !== undefined && { runId: sorted[0].runId, agentId: sorted[0].agentId }),
    events: sorted.length,
    chain: verifyChain(sorted),
    actions,
    ...(goalVerification !== undefined && { goalVerification }),
    ...(outcome !== undefined && { outcome }),
    ...(usage !== undefined && { usage }),
    counts: {
      actions: actions.length,
      denied: actions.filter((a) => a.policy === 'denied').length,
      verificationFailures,
    },
  };
}

/** Human-readable evidence report — what `naro verify` prints. */
export function formatEvidence(record: EvidenceRecord): string {
  const lines: string[] = [];
  const { chain } = record;
  lines.push(`run ${record.runId ?? '?'} (${record.agentId ?? '?'}) — ${record.events} events`);
  lines.push(
    chain.ok
      ? `chain: OK (${chain.length - chain.unchained} chained events${chain.unchained ? `, ${chain.unchained} legacy` : ''}, head ${chain.head?.slice(0, 12) ?? '—'}…)`
      : `chain: BROKEN — ${chain.reason ?? 'unknown'}${chain.brokenAt !== undefined ? ` (seq ${chain.brokenAt})` : ''}`,
  );
  if (chain.sealed) {
    lines.push(chain.sealed.ok
      ? `seal: VALID (ed25519, key ${chain.sealed.publicKey?.split('\n')[1]?.slice(0, 24) ?? '?'}…)`
      : `seal: INVALID — ${chain.sealed.reason ?? 'unknown'}`);
  }
  for (const a of record.actions) {
    const gate = a.policy === 'denied' ? `denied (${a.deniedReason})` : a.policy;
    const obs = a.observation
      ? a.observation.success ? `observed ok` : `observed FAILED${a.observation.error ? `: ${a.observation.error}` : ''}`
      : a.executed ? 'no observation' : 'not executed';
    const ver = a.verification
      ? a.verification.ok ? `verified by ${a.verification.verifier ?? 'verifier'}` : `verification FAILED by ${a.verification.verifier ?? 'verifier'}${a.verification.reason ? `: ${a.verification.reason}` : ''}`
      : 'unverified';
    lines.push(`  ${a.actionId} [${a.capability}] ${gate} → ${obs} → ${ver}`);
  }
  if (record.goalVerification) {
    const g = record.goalVerification;
    lines.push(`goal: ${g.ok ? 'verified' : 'verification FAILED'} by ${g.verifier ?? 'verifier'}${g.reason ? ` — ${g.reason}` : ''}`);
  }
  if (record.outcome) lines.push(`outcome: ${record.outcome.status}${record.outcome.detail ? ` — ${record.outcome.detail}` : ''}`);
  return lines.join('\n');
}
