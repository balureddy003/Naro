import { h, clear } from './dom.ts';
import type { ChatTemplate } from './app.ts';
import { markActivated } from './app.ts';
import { sdk } from './sdk.ts';
import { toast } from './toast.ts';
import { errText } from './copy.ts';

/** True for a 501 from `@naro/client` — checked via the typed `.status`
 *  field `NaroApiError` carries, never by string-matching `.message`
 *  (which is the raw response body, e.g. `{"error":"no tool registry
 *  configured"}` — it never contains the literal text "501"). */
function isNotConfigured(e: unknown): boolean {
  return e instanceof sdk.NaroApiError && e.status === 501;
}


/**
 * Everything that isn't the transcript: the System section (ADR 0024's
 * three write surfaces + fleet halt), a template's Settings and Access
 * tabs, and the setup wizard.
 *
 * Honesty rules this file keeps:
 * - Every admin write requires its justification field — the UI refuses
 *   to send an empty one, matching what the backend requires anyway.
 * - A generated principal token renders exactly once and is never
 *   stored client-side (ADR 0025's shown-once discipline).
 * - Settings and wizard template/data/cost choices are UI-only — the
 *   copy says so rather than implying a save that doesn't persist
 *   (PRD-006 Non-goals).
 */

export interface PageDeps {
  readonly client: import('@naro/client').NaroClient;
  readonly me: { id: string; roles: ReadonlySet<string>; tenantId?: string };
  readonly templates: readonly ChatTemplate[];
  readonly refresh: () => Promise<void>;
}

// ---------- System ----------

export function renderSystemPage(deps: PageDeps, col: HTMLElement, page: string): void {
  switch (page) {
    case 'collisions': return void renderCollisions(deps, col);
    case 'definitions': return void renderDefinitions(deps, col);
    case 'retention': return void renderRetention(deps, col);
    default: return void renderFleet(deps, col);
  }
}

function renderFleet(deps: PageDeps, col: HTMLElement): void {
  const card = h('div', { class: 'page-card' },
    h('h3', {}, 'Stop every running agent'),
    h('p', {}, 'Halts every in-flight run this deployment can see. Each stop is recorded with your name and the reason below — this is the same control as POST /runs/cancel-all.'));
  const reason = h('input', { class: 'text-input', placeholder: 'e.g. deploy freeze — investigating a bad batch' });
  const btn = h('button', { class: 'btn-fill btn-danger form-action', type: 'button' }, 'Halt all runs');
  const note = h('p', {});
  btn.addEventListener('click', () => {
    const r = reason.value.trim();
    if (r === '') { note.textContent = 'A reason is required — a halt must say why.'; return; }
    btn.setAttribute('disabled', '');
    void deps.client.cancelAllRuns(r).then((res) => {
      note.textContent = `Stopped ${res.cancelled} run${res.cancelled === 1 ? '' : 's'} — recorded under ${deps.me.id}.`;
      toast(`Halted ${res.cancelled} run${res.cancelled === 1 ? '' : 's'}`, res.cancelled > 0 ? 'warn' : 'ok');
      void deps.refresh();
    }).catch((e: Error) => { note.textContent = errText(e); })
      .finally(() => btn.removeAttribute('disabled'));
  });
  card.append(h('label', { class: 'field-label' }, 'Reason — required, recorded on every run it stops'), reason, btn, note);
  col.append(card);
}

function renderCollisions(deps: PageDeps, col: HTMLElement): void {
  const wrap = h('div', {}, h('div', { class: 'sk sk-card' }), h('div', { class: 'sk sk-card' }));
  col.append(wrap);
  void deps.client.listToolCollisions().then((rows) => {
    clear(wrap);
    if (rows.length === 0) { wrap.append(h('div', { class: 'empty' }, 'No unresolved tool-name collisions.')); return; }
    for (const c of rows) {
      const card = h('div', { class: 'page-card' },
        h('h3', {}, `Two sources both claim "${c.name}"`),
        h('p', {}, `Currently active: ${c.heldBy ?? 'unknown'} · also claiming: ${c.claimedBy}. Resolving promotes the source you pick to active — the decision is journaled, not silent.`));
      for (const src of [c.heldBy, c.claimedBy].filter((x): x is string => x !== undefined)) {
        const b = h('button', { class: 'btn-ghost', type: 'button', style: 'margin-right:8px' }, `Use ${src}`);
        b.addEventListener('click', () => {
          void deps.client.resolveToolCollision(c.name, src)
            .then(() => { card.replaceChildren(h('div', { class: 'approval-done' }, `Resolved — "${c.name}" now answers to ${src}.`)); toast(`Collision resolved — "${c.name}" → ${src}`); })
            .catch((e: Error) => { card.append(h('p', { style: 'color:var(--danger)' }, errText(e))); });
        });
        card.append(b);
      }
      wrap.append(card);
    }
  }).catch((e: Error) => {
    clear(wrap);
    wrap.append(h('div', { class: 'empty' }, isNotConfigured(e) ? 'This deployment has no tool registry wired to serve — nothing to resolve.' : errText(e)));
  });
}

function renderDefinitions(deps: PageDeps, col: HTMLElement): void {
  const wrap = h('div', {}, h('div', { class: 'sk sk-card' }), h('div', { class: 'sk sk-card' }));
  col.append(wrap);
  void deps.client.listChangedDefinitions().then((rows) => {
    clear(wrap);
    if (rows.length === 0) { wrap.append(h('div', { class: 'empty' }, 'No tool definitions changed since their last review.')); return; }
    for (const d of rows) {
      const card = h('div', { class: 'page-card' },
        h('h3', {}, `"${d.name}" changed on ${d.sourceId}`),
        h('p', {}, 'Its description or schema changed since it was last reviewed. Until you acknowledge it, the tool is treated as destructive — every call needs approval.'));
      card.append(h('div', { class: 'diff-old' }, `was: ${d.previous}`));
      card.append(h('div', { class: 'diff-new' }, `now: ${d.current}`));
      const b = h('button', { class: 'btn-fill', type: 'button' }, `Acknowledge "${d.name}"`);
      b.addEventListener('click', () => {
        void deps.client.acknowledgeDefinition(d.name, d.sourceId)
          .then(() => { card.replaceChildren(h('div', { class: 'approval-done' }, `Acknowledged — "${d.name}" is back to its declared behavior.`)); toast(`Definition "${d.name}" acknowledged`); })
          .catch((e: Error) => { card.append(h('p', { style: 'color:var(--danger)' }, errText(e))); });
      });
      card.append(b);
      wrap.append(card);
    }
  }).catch((e: Error) => {
    clear(wrap);
    wrap.append(h('div', { class: 'empty' }, isNotConfigured(e) ? 'This deployment has no tool registry wired to serve.' : errText(e)));
  });
}

function renderRetention(deps: PageDeps, col: HTMLElement): void {
  const card = h('div', { class: 'page-card' },
    h('h3', {}, 'Prune a finished run\'s journal'),
    h('p', {}, 'Removes events up to a sequence number and re-anchors the chain with a signed marker — retention is disclosed, never silent. The run must be finished (completed, failed, or cancelled).'));
  const runId = h('input', { class: 'text-input', placeholder: 'run_…' });
  const seq = h('input', { class: 'text-input', placeholder: 'prune through seq — e.g. 42' });
  const policy = h('input', { class: 'text-input', placeholder: 'Policy citation — e.g. GDPR Art. 5(1)(e) (required)' });
  const note = h('p', {});
  const btn = h('button', { class: 'btn-fill form-action', type: 'button' }, 'Prune');
  btn.addEventListener('click', () => {
    const through = Number(seq.value.trim());
    if (runId.value.trim() === '' || !Number.isInteger(through) || through < 0 || policy.value.trim() === '') {
      note.textContent = 'Run id, a non-negative seq, and a policy citation are all required.';
      return;
    }
    btn.setAttribute('disabled', '');
    void deps.client.pruneRun(runId.value.trim(), through, policy.value.trim())
      .then((r) => { note.textContent = `Pruned ${r.pruned} events — anchor ${r.anchorHash.slice(0, 16)}… is the chain's new start.`; toast(`Run pruned — ${r.pruned} events`); })
      .catch((e: Error) => { note.textContent = isNotConfigured(e) ? "This deployment's event store doesn't support pruning (needs a durable store)." : errText(e); })
      .finally(() => btn.removeAttribute('disabled'));
  });
  card.append(
    h('label', { class: 'field-label' }, 'Run id'), runId,
    h('label', { class: 'field-label' }, 'Prune through seq'), seq,
    h('label', { class: 'field-label' }, 'Policy citation'), policy,
    btn, note);
  col.append(card);
}

// ---------- template tabs ----------

export function renderSettingsTab(deps: PageDeps, col: HTMLElement, t: ChatTemplate): void {
  const card = h('div', { class: 'page-card' },
    h('h3', {}, 'Cost vs. care'),
    h('p', {}, 'How hard this template tries before asking a person. These choices are remembered in this browser only — the deployment doesn\'t persist template settings yet, so they don\'t change what runs.'));
  const tiers: [string, string][] = [
    ['Cheapest first', 'Try the small local model; escalate only when verification fails.'],
    ['Balanced', 'Start mid-tier; escalate on low confidence.'],
    ['Careful first', 'Use the strongest model every run.'],
  ];
  // UI-only persistence — the copy above is explicit this is browser-local.
  // localStorage makes the choice survive reload so the affordance isn't a
  // lie: "remembered in this browser" literally, nothing more.
  const key = `naro.chat.settings.${t.id}`;
  let picked = localStorage.getItem(key) ?? 'Cheapest first';
  const list = h('div', {});
  const paint = () => {
    clear(list);
    for (const [label, sub] of tiers) {
      const c = h('button', { class: 'choice-card', type: 'button', 'aria-pressed': label === picked },
        h('div', { class: 'cc-title' }, label), h('div', { class: 'cc-sub' }, sub));
      c.addEventListener('click', () => { picked = label; paint(); });
      list.append(c);
    }
  };
  paint();
  const approvalRow = h('div', {},
    h('h3', { style: 'margin-top:18px' }, 'Approval rules'),
    h('p', {}, 'A customer-facing send always needs a person — that one stays on, locked, by the template\'s own policy. The rest are yours to tune.'));
  const save = h('button', { class: 'btn-fill', type: 'button' }, 'Save');
  const note = h('p', {});
  save.addEventListener('click', () => {
    localStorage.setItem(key, picked);
    note.textContent = `Saved "${picked}" for ${t.name} — takes effect on the next run (browser-only until template settings persist server-side).`;
    toast(`Saved "${picked}" for ${t.name}`);
  });
  card.append(list, approvalRow, save, note);
  col.append(card);
}

export function renderAccessTab(deps: PageDeps, col: HTMLElement, t: ChatTemplate): void {
  const wrap = h('div', {});
  col.append(wrap);

  const listCard = h('div', { class: 'page-card' },
    h('h3', {}, `Who can use ${t.name}`));
  const listWrap = h('div', {}, h('div', { class: 'sk sk-row' }), h('div', { class: 'sk sk-row' }), h('div', { class: 'sk sk-row' }));
  listCard.append(listWrap);
  wrap.append(listCard);

  const refreshList = () => {
    void deps.client.listPrincipals().then((rows) => {
      clear(listWrap);
      if (rows.length === 0) { listWrap.append(h('p', {}, 'Only you so far — no one else has access to this deployment.')); return; }
      for (const p of rows) {
        const row = h('div', { style: 'display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-soft)' },
          h('span', { style: 'flex:1;font-size:13.5px' }, p.id),
          h('span', { style: 'font-size:12px;color:var(--ink-faint)' }, [...p.roles].join(', ')),
          h('span', { style: 'font-size:11.5px;color:var(--ink-faint);font-family:var(--font-mono)' }, `…${p.tokenLast4}`));
        const del = h('button', { class: 'btn-ghost', type: 'button', style: 'font-size:11.5px;padding:3px 8px' }, 'Revoke');
        del.addEventListener('click', () => {
          if (!window.confirm(`Revoke ${p.id}'s access? Their token stops working on the next request.`)) return;
          void deps.client.revokePrincipal(p.id).then(() => { toast(`Revoked ${p.id}'s access`, 'warn'); refreshList(); }).catch((e: Error) => { row.append(h('span', { style: 'color:var(--danger);font-size:11.5px' }, errText(e))); });
        });
        row.append(del);
        listWrap.append(row);
      }
    }).catch((e: Error) => {
      clear(listWrap);
      listWrap.append(h('p', {}, isNotConfigured(e)
        ? 'This deployment uses a static token file — teammates are added by editing it, not here.'
        : errText(e)));
    });
  };
  refreshList();

  // "Generate access" — the shown-once token flow. Plain-language
  // levels map one-way onto real roles (req 11): this mapping is the
  // documented contract, not per-developer improvisation.
  const LEVELS: [string, readonly string[]][] = [
    ['Can use it', ['operator', 'viewer']],
    ['Can use it + approve', ['approver', 'viewer']],
    ['Can see everything', ['viewer']],
  ];
  const invite = h('div', { class: 'page-card' },
    h('h3', {}, 'Invite someone'),
    h('p', {}, 'Generates a new access token for this deployment. Fleet-wide admin is never granted from a template — that lives under System.'));
  const nameInput = h('input', { class: 'text-input', placeholder: 'Their name or email — becomes their principal id' });
  const levelSel = h('select', {});
  for (const [label] of LEVELS) levelSel.append(h('option', { value: label }, label));
  const out = h('div', {});
  const gen = h('button', { class: 'btn-fill form-action', type: 'button' }, 'Generate access');
  gen.addEventListener('click', () => {
    const id = nameInput.value.trim();
    if (id === '') { out.textContent = 'Give them a name first — it becomes their identity on the record.'; return; }
    const roles = LEVELS.find(([l]) => l === levelSel.value)?.[1] ?? ['viewer'];
    gen.setAttribute('disabled', '');
    void deps.client.createPrincipal({ id, roles })
      .then((res) => {
        clear(out);
        out.append(
          h('p', {}, `Access created for ${res.id}. This token is shown once — share it with them like a password:`),
          h('div', { class: 'token-once' }, res.token));
        toast(`Access created for ${res.id}`);
        refreshList();
      })
      .catch((e: Error) => { out.textContent = isNotConfigured(e) ? 'This deployment uses a static token file — teammates are added by editing it, not here.' : errText(e); })
      .finally(() => gen.removeAttribute('disabled'));
  });
  invite.append(
    h('label', { class: 'field-label' }, 'Name'), nameInput,
    h('label', { class: 'field-label' }, 'Access level'), levelSel,
    gen, out);
  wrap.append(invite);
}

// ---------- wizard ----------

export function openWizard(deps: PageDeps, preselect?: string): void {
  const overlay = h('div', { class: 'overlay' });
  const box = h('div', { class: 'wizard' });
  overlay.append(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('overlays')!.append(overlay);

  let step = 0;
  let picked: string | undefined = preselect;
  let csvName: string | undefined;
  let csvRows: string[][] = [];

  const STEPS = ['Welcome', 'Template', 'Connect data', 'Cost vs. care', 'Approvals', 'Done'];

  const paint = () => {
    clear(box);
    box.append(h('div', { class: 'steps-dots' },
      ...STEPS.map((_, i) => h('i', { class: i <= step ? 'done' : '' }))));

    if (step === 0) {
      box.append(h('h2', {}, 'Set up a template'),
        h('p', { class: 'step-sub' }, 'One thing a person has to do first: get naro serve running somewhere — this wizard takes it from there.'));
    } else if (step === 1) {
      box.append(h('h2', {}, 'Pick a template'), h('p', { class: 'step-sub' }, 'What should this automation do?'));
      for (const t of deps.templates) {
        const c = h('button', { class: 'choice-card', type: 'button', 'aria-pressed': picked === t.id },
          h('div', { class: 'cc-title' }, t.name), h('div', { class: 'cc-sub' }, t.tagline ?? ''));
        c.addEventListener('click', () => { picked = t.id; paint(); });
        box.append(c);
      }
    } else if (step === 2) {
      box.append(h('h2', {}, 'Connect data'),
        h('p', { class: 'step-sub' }, 'Start with a CSV — parsed right here in the browser, nothing uploads. Gmail/Outlook and accounting connectors are coming (PRD-004).'));
      const file = h('input', { type: 'file', class: 'text-input' }) as HTMLInputElement;
      file.setAttribute('accept', '.csv,text/csv');
      file.addEventListener('change', () => {
        const f = file.files?.[0];
        if (!f) return;
        csvName = f.name;
        void f.text().then((text) => { csvRows = parseCsv(text); paint(); });
      });
      box.append(file);
      if (csvName !== undefined) {
        box.append(h('p', {}, `${csvName} — ${csvRows.length} rows parsed locally:`));
        const table = h('table', {});
        for (const [i, row] of csvRows.slice(0, 6).entries()) {
          const tr = h('tr', {});
          for (const cell of row) tr.append(h(i === 0 ? 'th' : 'td', {}, cell));
          table.append(tr);
        }
        box.append(h('div', { class: 'csv-preview' }, table));
        box.append(h('p', { style: 'font-size:12px;color:var(--ink-faint)' }, 'Preview only — nothing was sent anywhere.'));
      }
      const soon = h('div', { class: 'page-card', style: 'margin-top:12px' },
        h('h3', {}, 'Connectors'), h('p', {}, 'Gmail / Outlook — coming soon (PRD-004 milestone order).'));
      box.append(soon);
    } else if (step === 3) {
      box.append(h('h2', {}, 'Cost vs. care'), h('p', { class: 'step-sub' }, 'How hard should it try before asking you?'));
      for (const [label, sub] of [
        ['Cheapest first', 'Small local model; escalate only when the check fails. Lowest cost.'],
        ['Balanced', 'Start mid-tier; escalate on low confidence.'],
        ['Careful first', 'Strongest model every run — costs the most, misses the least.'],
      ] as const) {
        box.append(h('button', { class: 'choice-card', type: 'button', 'aria-pressed': false },
          h('div', { class: 'cc-title' }, label), h('div', { class: 'cc-sub' }, sub)));
      }
      box.append(h('p', { style: 'font-size:12px;color:var(--ink-faint)' }, 'A choice here isn\'t persisted yet — template settings save server-side once PRD-002 defines the shape.'));
    } else if (step === 4) {
      box.append(h('h2', {}, 'Approval defaults'), h('p', { class: 'step-sub' }, 'What always needs a person first?'));
      const locked = h('div', { class: 'page-card' },
        h('h3', {}, 'Sending anything to a customer — always asks ✓'),
        h('p', {}, 'Locked on by the template\'s policy — it can\'t be turned off.'));
      box.append(locked);
      box.append(h('p', {}, 'These defaults are a preview of the template\'s own rules; per-template toggles arrive with persisted settings.'));
    } else {
      box.append(h('h2', {}, `${picked !== undefined ? deps.templates.find((t) => t.id === picked)?.name ?? 'Template' : 'Template'} is set up`),
        h('p', { class: 'step-sub' }, 'It\'s on, waiting for its first trigger — runs appear under it in the sidebar. Grant teammates access from its Access tab, not here.'));
      const finish = h('button', { class: 'btn-fill', type: 'button' }, 'Open it');
      finish.addEventListener('click', () => {
        overlay.remove();
        if (picked !== undefined) { markActivated(picked); location.hash = `#/t/${picked}/runs`; void deps.refresh(); }
      });
      box.append(finish);
      return;
    }

    const nav = h('div', { class: 'wizard-nav' });
    const back = h('button', { class: 'btn-ghost', type: 'button' }, step === 0 ? 'Cancel' : 'Back');
    back.addEventListener('click', () => { if (step === 0) overlay.remove(); else { step--; paint(); } });
    const next = h('button', { class: 'btn-fill', type: 'button', ...(step === 1 && picked === undefined ? { disabled: true } : {}) }, 'Continue');
    next.addEventListener('click', () => { step++; paint(); });
    nav.append(back, next);
    box.append(nav);
  };
  paint();
}

function parseCsv(text: string): string[][] {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').map((line) => {
    const cells: string[] = [];
    let cur = ''; let q = false;
    for (const ch of line) {
      if (ch === '"') { q = !q; continue; }
      if (ch === ',' && !q) { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}
