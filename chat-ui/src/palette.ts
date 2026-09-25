import { h, clear } from './dom.ts';
import { icon } from './icons.ts';
import { toast } from './toast.ts';
import type { RunSummary } from '@naro/client';
import type { PageDeps } from './pages.ts';
import type { ChatTemplate } from './app.ts';

/**
 * Cmd/Ctrl+K command palette — Linear's pattern scoped to what this app
 * actually has: jump to a template/run, open a tab, the two real
 * commands (fleet halt navigates to its page rather than firing blind —
 * a halt still has to say why), sign out. Subsequence-matched, arrow
 * navigable, Escape/outside-click dismisses.
 */

export interface PaletteDeps extends PageDeps {
  readonly runs: readonly RunSummary[];
  readonly isAdmin: boolean;
  readonly signOut: () => void;
  readonly openWizard: () => void;
}

interface Cmd {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
  readonly icon: Parameters<typeof icon>[0];
  readonly run: () => void;
}

/** Subsequence match — "tcl" hits "Transaction categorizer". Score =
 *  matched-word-start bonus minus span length; undefined = no match. */
function fuzzy(query: string, text: string): number | undefined {
  const q = query.toLowerCase(); const t = text.toLowerCase();
  if (q === '') return 0;
  let qi = 0; let score = 0; let last = -1;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += (i === 0 || t[i - 1] === ' ' || t[i - 1] === '-') ? 3 : 1;
      if (last === i - 1) score += 1; // consecutive bonus
      last = i; qi++;
    }
  }
  return qi === q.length ? score : undefined;
}

function commands(d: PaletteDeps): Cmd[] {
  const cmds: Cmd[] = [];
  for (const t of d.templates) {
    cmds.push({ id: `t:${t.id}`, title: `Go to ${t.name}`, hint: 'template', icon: 'arrow', run: () => { location.hash = `#/t/${t.id}/runs`; } });
    if (d.isAdmin) {
      cmds.push({ id: `s:${t.id}`, title: `${t.name} → Settings`, hint: 'tab', icon: 'gear', run: () => { location.hash = `#/t/${t.id}/settings`; } });
      cmds.push({ id: `a:${t.id}`, title: `${t.name} → Access`, hint: 'tab', icon: 'key', run: () => { location.hash = `#/t/${t.id}/access`; } });
    }
  }
  for (const r of d.runs.slice(0, 30)) {
    const tpl = d.templates.find((t) => r.specName === `tpl:${t.id}` || r.specName === t.id);
    cmds.push({
      id: `r:${r.runId}`, title: r.goal.length > 48 ? `${r.goal.slice(0, 48)}…` : r.goal,
      hint: tpl?.name ?? 'run', icon: 'arrow',
      run: () => { location.hash = tpl !== undefined ? `#/t/${tpl.id}/runs/run/${encodeURIComponent(r.runId)}` : '#/general'; },
    });
  }
  cmds.push({ id: 'general', title: 'Other runs', hint: 'view', icon: 'arrow', run: () => { location.hash = '#/general'; } });
  if (d.isAdmin) {
    cmds.push({ id: 'new-template', title: 'New template…', hint: 'wizard', icon: 'arrow', run: () => d.openWizard() });
    cmds.push({
      id: 'halt', title: 'Halt all runs…', hint: 'System → Fleet control', icon: 'shield',
      run: () => {
        location.hash = '#/sys/fleet';
        toast('Fleet halt needs a reason — the field is focused', 'warn');
        setTimeout(() => (document.querySelector('#content .text-input') as HTMLElement | null)?.focus(), 60);
      },
    });
  }
  cmds.push({ id: 'signout', title: 'Sign out', hint: 'account', icon: 'logout', run: () => d.signOut() });
  return cmds;
}

let open = false;

export function openPalette(getDeps: () => PaletteDeps): void {
  if (open) return;
  open = true;
  const overlay = h('div', { class: 'palette' });
  const box = h('div', { class: 'palette-box', role: 'dialog', 'aria-label': 'Command palette' });
  const input = h('input', { class: 'palette-input', placeholder: 'Jump to a template, run, or command…', 'aria-label': 'Command palette' });
  const list = h('div', { class: 'palette-list', role: 'listbox' });
  box.append(input, list);
  overlay.append(box);
  document.body.append(overlay);

  const close = () => { open = false; overlay.remove(); };
  let sel = 0;
  let matches: Cmd[] = [];

  const render = () => {
    const d = getDeps();
    const q = input.value.trim();
    matches = commands(d)
      .map((c) => ({ c, s: fuzzy(q, `${c.title} ${c.hint ?? ''}`) }))
      .filter((x): x is { c: Cmd; s: number } => x.s !== undefined)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.c);
    sel = Math.min(sel, Math.max(0, matches.length - 1));
    clear(list);
    if (matches.length === 0) {
      list.append(h('div', { class: 'palette-empty' }, 'No matching command'));
      return;
    }
    for (const [i, c] of matches.entries()) {
      const row = h('div', { class: `palette-item${i === sel ? ' sel' : ''}`, role: 'option', 'aria-selected': i === sel },
        icon(c.icon), h('span', {}, c.title));
      if (c.hint !== undefined) row.append(h('span', { class: 'pi-hint' }, c.hint));
      row.addEventListener('click', () => { close(); c.run(); });
      row.addEventListener('mousemove', () => { if (sel !== i) { sel = i; render(); } });
      list.append(row);
    }
  };

  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, matches.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = matches[sel]; if (c !== undefined) { close(); c.run(); } }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  render();
  input.focus();
}

/** Global ⌘K / Ctrl+K binding — installed once at boot. */
export function installPalette(getDeps: () => PaletteDeps): void {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette(getDeps);
    }
  });
}
