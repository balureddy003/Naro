import { h, clear, shortHash } from './dom.ts';
import { icon } from './icons.ts';
import { policyBadge, runStatusLabel, errText } from './copy.ts';
import { attachApprovalId, transcriptFromEvents, type ApprovalItem, type ChipItem, type Transcript } from './viewmodel.ts';
import type { PageDeps } from './pages.ts';
import type { RunSummary } from '@naro/client';
import { sdk } from './sdk.ts';
import { disposers } from './lifecycle.ts';
import type { ChatTemplate } from './app.ts';

/**
 * The Runs tab: a run's journal as a conversation — goal as the user
 * message, action chips as the work, approval cards inline, the
 * completed/failed/cancelled event as the last word. Evidence is
 * opt-in: every chip expands in place to the same fields the console
 * shows, with the chain hash that proves it's the journal's record.
 */
export async function renderRun(
  deps: PageDeps,
  col: HTMLElement,
  run: RunSummary,
  template?: ChatTemplate,
): Promise<void> {
  let transcript: Transcript = { items: [], status: 'running' };

  // The goal text is the first user message — what the person asked for.
  col.append(h('div', { class: 'msg-user' }, run.goal));
  const transcriptEl = h('div', {});
  col.append(transcriptEl);
  const statusEl = h('div', { class: 'msg-system' });
  col.append(statusEl);
  const metaEl = h('div', { class: 'run-meta', style: 'display:none' });
  col.append(metaEl);

  // Skeleton while the first journal events arrive — the frame is
  // instant, the stream isn't. Two chips + a card match a real run's
  // shape, so the swap doesn't jump the layout.
  for (const cls of ['sk sk-chip', 'sk sk-chip', 'sk sk-card']) transcriptEl.append(h('div', { class: cls }));

  // Cross-tenant (unscoped) principals get the chain banner pinned over
  // the transcript — "what you're looking at is the same record
  // naro verify would print" (PRD-006, ADR 0013 visibility).
  if (deps.me.tenantId === undefined) {
    const banner = h('div', { class: 'chain-banner' }, 'Checking the record…');
    col.prepend(banner);
    void deps.client.getEvidence(run.runId).then((ev) => {
      const sealed = ev.chain.sealed?.ok === true ? ` · sealed (${ev.chain.sealed.publicKey !== undefined ? 'ed25519' : 'unsigned'})` : '';
      const text = ev.chain.ok
        ? `Chain OK${sealed} · ${ev.events} events · this is the same record naro verify prints`
        : `Chain BROKEN at event ${ev.chain.brokenAt ?? '?'} — this record does not verify`;
      banner.className = `chain-banner${ev.chain.ok ? '' : ' danger'}`;
      banner.textContent = text;
    }).catch(() => { banner.remove(); });
  }

  const painted = new Set<number>();
  const repaint = (): void => {
    clear(transcriptEl);
    for (const item of transcript.items) {
      if (item.kind === 'chip') {
        const el = renderChip(item);
        if (!painted.has(item.seq)) { el.classList.add('chip-enter'); painted.add(item.seq); }
        transcriptEl.append(el);
      }
      else if (item.kind === 'approval') transcriptEl.append(renderApproval(deps, item));
      else if (item.result !== undefined) transcriptEl.append(renderResult(item.result));
      else transcriptEl.append(h('div', { class: `msg-${item.role === 'user' ? 'user' : item.role === 'system' ? 'system' : 'assistant'}` }, item.text));
    }
    const st = runStatusLabel(transcript.status);
    statusEl.textContent = st.text === 'Done' ? '' : st.text;
    statusEl.style.display = statusEl.textContent === '' ? 'none' : '';

    // Run meta — what it actually cost and what proved it. Real numbers
    // from the journal (model.usage totals), never estimates.
    clear(metaEl);
    const parts: string[] = [];
    if (transcript.usage !== undefined) {
      parts.push(`${transcript.usage.totalTokens.toLocaleString()} tokens`);
      parts.push(transcript.usage.costUsd > 0 ? `$${transcript.usage.costUsd.toFixed(4)}` : '$0.00');
    }
    if (run.specName !== undefined) {
      const tpl = deps.templates.find((x) => run.specName === `tpl:${x.id}` || run.specName === x.id);
      parts.push(`via ${tpl?.name ?? run.specName}`);
    }
    if (parts.length > 0) metaEl.append(parts.join(' · '));
    metaEl.style.display = parts.length === 0 ? 'none' : '';
  };

  // Stop control — visible while the run is in flight and the caller
  // can cancel (operator). ADR 0022's endpoint, one tap away.
  const stopWrap = h('div', { style: 'margin:8px 0' });
  col.append(stopWrap);
  const maybeStop = (): void => {
    clear(stopWrap);
    if (transcript.status !== 'running' || !deps.me.roles.has('operator')) return;
    const btn = h('button', { class: 'stop-btn', type: 'button' }, 'Stop this run');
    btn.addEventListener('click', () => {
      const reason = window.prompt('Stop this run — say why (it goes on the record):');
      if (reason === null || reason.trim() === '') return;
      void deps.client.cancelRun(run.runId, reason.trim()).then(() => deps.refresh());
    });
    stopWrap.append(btn);
  };

  repaint();
  maybeStop();

  // The stream: watchRun tails the journal, reshapes, repaints — the
  // whole "streams as chat turns" requirement is this loop. The
  // transcript needs the full ordered set — accumulate and re-shape per
  // event (cheap: journals are small; correctness beats incremental
  // diffing).
  const seen: import('@naro/client').RunEvent[] = [];
  disposers.push(sdk.watchRun(deps.client, run.runId, {
    onEvent: (e) => {
      seen.push(e);
      transcript = transcriptFromEvents(seen);
      attachApprovalId(transcript, pendingApprovals);
      repaint();
      maybeStop();
    },
  }));

  // Pending approvals — the card's answer buttons need the real id,
  // which lives on /approvals, not the journal event.
  let pendingApprovals: { id: string; question: string }[] = [];
  disposers.push(sdk.pollApprovals(deps.client, {
    intervalMs: 2500,
    onData: (reqs) => {
      pendingApprovals = reqs.filter((r) => r.answer === undefined).map((r) => ({ id: r.id, question: r.question }));
      attachApprovalId(transcript, pendingApprovals);
      repaint();
    },
    onError: () => {},
  }));
}

function renderChip(chip: ChipItem): HTMLElement {
  const badge = chip.status === 'pending' ? { cls: 'warn', text: 'Working…' } : policyBadge(chip.policy, chip.verification);
  const el = h('button', { class: 'chip', type: 'button' },
    h('span', { class: `dot ${chip.status === 'pending' ? 'pending' : badge.cls}` }),
    h('span', {}, chip.label),
    h('span', { style: 'font-size:11px;color:var(--ink-faint)' }, badge.text),
    h('span', { class: 'chev' }, icon('caret')));

  let expanded: HTMLElement | undefined;
  el.addEventListener('click', () => {
    if (expanded !== undefined) { expanded.remove(); expanded = undefined; el.classList.remove('open'); return; }
    el.classList.add('open');
    const ev = h('div', { class: 'evidence' });
    const row = (k: string, v: string) => ev.append(h('div', { class: 'evrow' }, h('span', { class: 'k' }, k), h('span', {}, v)));
    row('policy', chip.policy);
    if (chip.verification) row('verifier', `${chip.verification.verifier ?? 'verifier'} — ${chip.verification.ok ? 'ok' : `failed${chip.verification.reason !== undefined ? `: ${chip.verification.reason}` : ''}`}`);
    if (chip.observation) row('observation', chip.observation.success ? 'ok' : `error: ${chip.observation.error ?? 'unknown'}`);
    row('chain', shortHash(chip.hash));
    ev.append(h('div', { class: 'same' }, 'Same record naro verify prints — the journal, not a summary.'));
    el.after(ev);
    expanded = ev;
  });
  return el;
}

function renderApproval(deps: PageDeps, item: ApprovalItem): HTMLElement {
  if (item.status !== 'pending') {
    const cls = item.status === 'approved' ? 'resolved' : 'rejected';
    return h('div', { class: `approval-card ${cls}` },
      h('div', { class: `approval-done${item.status === 'approved' ? '' : ' no'}` },
        item.status === 'approved'
          ? `Confirmed — recorded${item.by !== undefined ? ` by ${item.by}` : ''}`
          : `Declined — recorded${item.by !== undefined ? ` by ${item.by}` : ''}`));
  }

  const card = h('div', { class: 'approval-card' },
    h('div', { class: 'approval-q' }, item.question));
  const input = h('input', { class: 'approval-input', type: 'text', placeholder: 'Your answer (optional — approve as-is or correct it)' });
  card.append(input);
  const actions = h('div', { class: 'approval-actions' });
  const can = deps.me.roles.has('approver');
  const yes = h('button', { class: 'btn-fill', type: 'button', ...(can ? {} : { disabled: true }) }, 'Approve');
  const no = h('button', { class: 'btn-ghost', type: 'button', ...(can ? {} : { disabled: true }) }, 'Decline');
  if (!can) card.append(h('div', { class: 'approval-detail' }, 'Waiting for someone with approve permission.'));
  const answer = (approved: boolean) => {
    if (item.approvalId === undefined) return;
    // Optimistic: commit the visual state the instant they click — the
    // journal event reconciles it for real on the next poll. A failed
    // request rolls the card back with a visible error, never a lie.
    card.classList.add(approved ? 'resolved' : 'rejected', 'confirming');
    const confirming = h('div', { class: `approval-done${approved ? '' : ' no'}` },
      approved ? 'Confirming…' : 'Recording the decline…');
    actions.replaceChildren(confirming);
    yes.setAttribute('disabled', ''); no.setAttribute('disabled', '');
    void deps.client.answerApproval(item.approvalId, { approved, ...(input.value.trim() !== '' && { text: input.value.trim() }) })
      .then(() => {
        confirming.textContent = approved ? `Confirmed — recorded by ${deps.me.id}` : `Declined — recorded by ${deps.me.id}`;
        card.classList.remove('confirming');
        void deps.refresh();
      })
      .catch((e: Error) => {
        // Rollback — restore the live card and say why.
        card.classList.remove('resolved', 'rejected', 'confirming');
        actions.replaceChildren(yes, no);
        yes.removeAttribute('disabled'); no.removeAttribute('disabled');
        card.append(h('p', { style: 'color:var(--danger);font-size:12.5px;margin:8px 0 0' }, errText(e)));
      });
  };
  yes.addEventListener('click', () => answer(true));
  no.addEventListener('click', () => answer(false));
  actions.append(yes, no);
  card.append(actions);
  return card;
}

function renderResult(result: unknown): HTMLElement {
  const wrap = h('div', { class: 'msg-assistant' });
  if (typeof result === 'string') {
    wrap.append(h('div', {}, result));
    return wrap;
  }
  if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    wrap.append(h('div', {}, 'Done — here\'s what it found:'));
    const fields = h('div', { class: 'result-fields' });
    for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
      fields.append(h('div', { class: 'result-field' },
        h('span', { class: 'k' }, k), h('span', { class: 'v' }, formatValue(v))));
    }
    wrap.append(fields);
    return wrap;
  }
  wrap.append(h('div', {}, 'Done.'));
  return wrap;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
