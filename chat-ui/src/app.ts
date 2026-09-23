import { sdk } from './sdk.ts';
import { h, clear } from './dom.ts';
import { disposeAll } from './lifecycle.ts';
import { runStatusLabel } from './copy.ts';
import { renderRun } from './chat.ts';
import { renderSystemPage, renderSettingsTab, renderAccessTab, openWizard, type PageDeps } from './pages.ts';
import type { ApprovalRequest, RunSummary } from '@naro/client';

/**
 * App entry — boot, auth, routing, sidebar. One shell for every role:
 * what a principal sees IS what their roles permit (req 7) — System
 * absent entirely for non-admins, Settings/Access tabs only for admins
 * (the write-level role today's model has), composer only for operator+.
 */

export interface ChatTemplate {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly tagline?: string;
  /** Set by the deployment manifest; the wizard marks configured:true
   *  for the session — per-template setup state is UI-only until
   *  PRD-002/004 define a persisted shape (PRD-006 Non-goals). */
  configured?: boolean;
}

export interface AppState {
  client: InstanceType<typeof sdk.NaroClient>;
  me: { id: string; roles: ReadonlySet<string>; tenantId?: string; open?: boolean };
  templates: ChatTemplate[];
  runs: readonly RunSummary[];
  approvals: readonly ApprovalRequest[];
}

interface Route {
  view: 'template' | 'general' | 'system' | 'signin';
  templateId?: string;
  tab?: 'runs' | 'settings' | 'access';
  runId?: string;
  page?: string;
}

const TOKEN_KEY = 'naro.chat.token';
const ACTIVATED_KEY = 'naro.chat.activated';

function parseRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 't' && parts[1] !== undefined) {
    const tab = (['runs', 'settings', 'access'].includes(parts[2] ?? '') ? parts[2] : 'runs') as Route['tab'];
    return { view: 'template', templateId: decodeURIComponent(parts[1]), tab, ...(parts[3] === 'run' && parts[4] !== undefined && { runId: decodeURIComponent(parts[4]) }) };
  }
  if (parts[0] === 'general') return { view: 'general' };
  if (parts[0] === 'sys' && parts[1] !== undefined) return { view: 'system', page: parts[1] };
  return { view: 'template' };
}

function templateOf(state: AppState, run: RunSummary): ChatTemplate | undefined {
  return state.templates.find((t) => run.specName === `tpl:${t.id}` || run.specName === t.id);
}

function runsFor(state: AppState, templateId: string): RunSummary[] {
  return state.runs.filter((r) => {
    const t = templateOf(state, r);
    return (t?.id ?? r.specName) === templateId || t?.id === templateId;
  });
}

function generalRuns(state: AppState): RunSummary[] {
  return state.runs.filter((r) => templateOf(state, r) === undefined);
}

function isConfigured(state: AppState, t: ChatTemplate): boolean {
  return t.configured === true || runsFor(state, t.id).length > 0 || activated(state).has(t.id);
}

let activatedCache: Set<string> | undefined;
function activated(_state: AppState): Set<string> {
  if (activatedCache === undefined) {
    try { activatedCache = new Set(JSON.parse(localStorage.getItem(ACTIVATED_KEY) ?? '[]') as string[]); }
    catch { activatedCache = new Set(); }
  }
  return activatedCache;
}
export function markActivated(id: string): void {
  activatedCache = (activatedCache ?? new Set()).add(id);
  localStorage.setItem(ACTIVATED_KEY, JSON.stringify([...activatedCache!]));
}

// ---------- sidebar ----------

function renderSidebar(state: AppState, route: Route): void {
  const el = document.getElementById('sidebar')!;
  clear(el);
  const isAdmin = state.me.roles.has('admin');

  const head = h('div', { class: 'sidebar-head' });
  const ws = h('div', { class: 'workspace' },
    h('span', { class: 'workspace-mark' }, 'N'),
    h('div', {},
      h('div', { class: 'workspace-name' }, 'Naro'),
      h('div', { class: 'workspace-sub' }, `signed in as ${state.me.id}`)));
  head.append(ws);
  head.append(h('span', { class: 'self-host-badge' }, 'self‑hosted · naro serve'));
  if (state.me.roles.has('admin')) {
    const newBtn = h('button', { class: 'new-btn', type: 'button' }, '+ New template');
    newBtn.addEventListener('click', () => openWizard(deps()));
    head.append(newBtn);
  }
  el.append(head);

  const body = h('div', { class: 'sidebar-body' });
  body.append(h('div', { class: 'nav-section' }, 'Templates'));

  for (const t of state.templates) {
    if (!isConfigured(state, t)) {
      const link = h('div', { class: 'setup-link' },
        h('span', { class: 'tmpl-icon' }, (t.icon ?? t.name.slice(0, 2)).toUpperCase()),
        h('span', {}, `${t.name}`), h('span', { style: 'margin-left:auto;font-size:11px;color:var(--ink-faint)' }, 'Set up →'));
      link.addEventListener('click', () => { location.hash = `#/t/${t.id}/runs`; });
      body.append(link);
      continue;
    }
    const group = h('div', { class: `tmpl-group${route.templateId === t.id ? ' open' : ''}` });
    const headRow = h('div', { class: 'tmpl-group-head' },
      h('span', { class: 'tmpl-caret' }, '▸'),
      h('span', { class: 'tmpl-icon' }, (t.icon ?? t.name.slice(0, 2)).toUpperCase()),
      h('span', { class: 'tmpl-name' }, t.name));
    headRow.addEventListener('click', () => { location.hash = `#/t/${t.id}/runs`; });
    if (isAdmin) {
      const gear = h('button', { class: 'gear-btn', type: 'button', 'aria-label': `${t.name} settings` }, '⚙');
      gear.addEventListener('click', (e) => { e.stopPropagation(); location.hash = `#/t/${t.id}/settings`; });
      headRow.append(gear);
    }
    group.append(headRow);

    const runList = h('div', { class: 'tmpl-runs' });
    for (const r of runsFor(state, t.id).slice(0, 20)) {
      const st = runStatusLabel(r.status);
      const row = h('div', { class: `run-row${route.runId === r.runId ? ' active' : ''}` },
        h('span', { class: `status-dot ${st.cls}` }),
        h('span', { class: 'rr-title' }, r.goal.length > 34 ? `${r.goal.slice(0, 34)}…` : r.goal),
        h('span', { class: 'rr-time' }, ago_(r.startedAt)));
      if (r.tenantId !== undefined) row.append(h('span', { class: 'rr-tenant' }, r.tenantId));
      row.addEventListener('click', () => { location.hash = `#/t/${t.id}/runs/run/${encodeURIComponent(r.runId)}`; });
      runList.append(row);
    }
    group.append(runList);
    body.append(group);
  }

  body.append(h('div', { class: 'nav-section' }, 'General'));
  const general = h('div', { class: `nav-link${route.view === 'general' ? ' active' : ''}` }, 'Other runs');
  general.addEventListener('click', () => { location.hash = '#/general'; });
  body.append(general);

  if (isAdmin) {
    body.append(h('div', { class: 'nav-section' }, 'System'));
    const pendingCount = state.approvals.filter((a) => a.answer === undefined).length;
    for (const [page, label] of [['fleet', 'Fleet control'], ['collisions', 'Tool collisions'], ['definitions', 'Definition changes'], ['retention', 'Retention']] as const) {
      const link = h('div', { class: `nav-link${route.page === page ? ' active' : ''}` }, label);
      if (page === 'collisions' || page === 'definitions') {
        // counts filled by the page's own fetch — badge pattern, no fake number
      }
      link.addEventListener('click', () => { location.hash = `#/sys/${page}`; });
      body.append(link);
    }
    if (pendingCount > 0) {
      const badge = h('div', { class: 'nav-link' }, 'Pending approvals', h('span', { class: 'nav-count' }, String(pendingCount)));
      badge.addEventListener('click', () => { location.hash = '#/general'; });
      body.append(badge);
    }
  }
  el.append(body);
}

function ago_(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return d === 1 ? 'yesterday' : `${d}d`;
}

// ---------- topbar ----------

function renderTopbar(state: AppState, route: Route): void {
  const el = document.getElementById('topbar')!;
  clear(el);
  const menu = h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'Menu' }, '☰');
  menu.addEventListener('click', () => {
    document.getElementById('sidebar')!.classList.toggle('open');
    document.getElementById('backdrop')!.classList.toggle('show');
  });
  el.append(menu);

  if (route.view === 'template' && route.templateId !== undefined) {
    const t = state.templates.find((x) => x.id === route.templateId);
    el.append(h('div', {},
      h('div', { class: 'topbar-title' }, t?.name ?? route.templateId),
      h('div', { class: 'topbar-sub' }, t?.tagline ?? 'outcome template')));
    if (isAdminRoles(state) && t !== undefined) {
      const tabs = h('div', { class: 'tabs' });
      for (const [tab, label] of [['runs', 'Runs'], ['settings', 'Settings'], ['access', 'Access']] as const) {
        const b = h('button', { class: `tab${route.tab === tab ? ' active' : ''}`, type: 'button' }, label);
        b.addEventListener('click', () => { location.hash = `#/t/${t.id}/${tab}`; });
        tabs.append(b);
      }
      el.append(tabs);
    }
  } else if (route.view === 'system') {
    const names: Record<string, string> = { fleet: 'Fleet control', collisions: 'Tool collisions', definitions: 'Definition changes', retention: 'Retention' };
    el.append(h('div', {},
      h('div', { class: 'topbar-title' }, names[route.page ?? ''] ?? 'System'),
      h('div', { class: 'topbar-sub' }, 'fleet-wide · admin')));
  } else {
    el.append(h('div', {},
      h('div', { class: 'topbar-title' }, 'Other runs'),
      h('div', { class: 'topbar-sub' }, 'runs not tied to a template')));
  }
}

function isAdminRoles(state: AppState): boolean {
  return state.me.roles.has('admin');
}

// ---------- content ----------

async function renderContent(state: AppState, route: Route): Promise<void> {
  const el = document.getElementById('content')!;
  disposeAll();
  clear(el);
  const col = h('div', { class: 'column' });
  el.append(col);
  const d = deps();

  if (route.view === 'system') {
    renderSystemPage(d, col, route.page ?? 'fleet');
    return;
  }
  if (route.view === 'general') {
    col.append(h('div', { class: 'nav-section' }, 'Runs'));
    const list = generalRuns(state);
    if (list.length === 0) col.append(h('div', { class: 'empty' }, 'No runs outside a template yet.'));
    for (const r of list.slice(0, 50)) {
      const st = runStatusLabel(r.status);
      const row = h('div', { class: 'page-card', style: 'cursor:pointer' },
        h('h3', {}, r.goal.length > 60 ? `${r.goal.slice(0, 60)}…` : r.goal),
        h('p', {}, `${st.text} · ${ago_(r.startedAt)} ago${r.tenantId !== undefined ? ` · ${r.tenantId}` : ''}`));
      row.addEventListener('click', () => { location.hash = `#/general`; void renderRunInto(col, r); });
      col.append(row);
    }
    return;
  }

  const t = state.templates.find((x) => x.id === route.templateId) ?? state.templates[0];
  if (t === undefined) {
    col.append(h('div', { class: 'empty' }, 'No templates configured. An admin can set one up with + New template.'));
    return;
  }
  if (!isConfigured(state, t)) {
    col.append(h('div', { class: 'page-card' },
      h('h3', {}, `${t.name} isn't set up yet`),
      h('p', {}, 'No runs, settings, or access yet — one setup pass and it\'s live.')));
    const b = h('button', { class: 'btn-fill', type: 'button' }, 'Set up now');
    b.addEventListener('click', () => openWizard(d, t.id));
    col.append(b);
    return;
  }
  if (route.tab === 'settings') { renderSettingsTab(d, col, t); return; }
  if (route.tab === 'access') { renderAccessTab(d, col, t); return; }

  // Runs tab
  if (route.runId !== undefined) {
    const run = state.runs.find((r) => r.runId === route.runId);
    if (run !== undefined) { await renderRunInto(col, run, t); return; }
  }
  const list = runsFor(state, t.id);
  if (list.length === 0) {
    col.append(h('div', { class: 'page-card' },
      h('h3', {}, `${t.name} is on, waiting for its first trigger`),
      h('p', {}, 'Nothing has invoked this template yet — when it runs, the conversation appears here.')));
  } else {
    await renderRunInto(col, list[0]!, t);
  }
  mountComposer(state, t);
}

async function renderRunInto(col: HTMLElement, run: RunSummary, t?: ChatTemplate): Promise<void> {
  clear(col);
  await renderRun(deps(), col, run, t);
}

// ---------- composer ----------

function mountComposer(state: AppState, t: ChatTemplate): void {
  const wrap = document.getElementById('composer')!;
  if (!state.me.roles.has('operator')) { wrap.style.display = 'none'; clear(wrap); return; }
  wrap.style.display = '';
  clear(wrap);
  const inner = h('div', { class: 'composer-inner' });
  const ta = h('textarea', { placeholder: `Ask ${t.name} to do something…`, rows: '1' });
  const send = h('button', { class: 'btn-fill', type: 'button' }, 'Send');
  const submit = async () => {
    const text = ta.value.trim();
    if (text === '') return;
    send.setAttribute('disabled', '');
    try {
      const { runId } = await state.client.submitGoal({ description: text, template: t.id });
      location.hash = `#/t/${t.id}/runs/run/${encodeURIComponent(runId)}`;
      await refresh(state);
    } finally {
      send.removeAttribute('disabled');
      ta.value = '';
    }
  };
  send.addEventListener('click', () => void submit());
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
  });
  inner.append(ta, send);
  wrap.append(inner);
}

function hideComposer(): void {
  const wrap = document.getElementById('composer')!;
  wrap.style.display = 'none';
  clear(wrap);
}

// ---------- boot ----------

let state: AppState;
function deps(): PageDeps {
  return { client: state.client, me: state.me, templates: state.templates, refresh: () => refresh(state) };
}

async function refresh(s: AppState): Promise<void> {
  try {
    [s.runs, s.approvals] = await Promise.all([s.client.listRuns(), s.client.listApprovals().catch(() => [] as ApprovalRequest[])]);
  } catch { /* stale data > no data — keep last good */ }
}

async function render(): Promise<void> {
  const route = parseRoute();
  hideComposer();
  renderSidebar(state, route);
  renderTopbar(state, route);
  await renderContent(state, route);
}

async function boot(): Promise<void> {
  const cfg = (window as unknown as { NARO_CHAT_CONFIG?: { templates?: ChatTemplate[] } }).NARO_CHAT_CONFIG ?? {};
  const templates = cfg.templates ?? [];

  const token = localStorage.getItem(TOKEN_KEY) ?? undefined;
  const client = new sdk.NaroClient({ baseUrl: location.origin, ...(token !== undefined && { token }) });

  let me: AppState['me'];
  try {
    const m = await client.me();
    me = { id: m.id, roles: new Set(m.roles), ...(m.tenantId !== undefined && { tenantId: m.tenantId }), ...(m.open === true && { open: true }) };
  } catch {
    renderSignIn(templates);
    return;
  }

  state = { client, me, templates, runs: [], approvals: [] };
  await refresh(state);
  window.addEventListener('hashchange', () => void render());
  await render();

  // Light polling — runs/approvals lists refresh the sidebar counts.
  sdk.pollRuns(client, {
    intervalMs: 4000,
    onData: (runs) => { state.runs = [...runs]; void render(); },
    onError: () => {},
  });
  sdk.pollApprovals(client, {
    intervalMs: 4000,
    onData: (approvals) => { state.approvals = [...approvals]; },
    onError: () => {},
  });
}

function renderSignIn(templates: ChatTemplate[]): void {
  const content = document.getElementById('content')!;
  clear(content);
  const col = h('div', { class: 'column signin' });
  const card = h('div', { class: 'page-card' },
    h('h3', {}, 'Sign in'),
    h('p', {}, `This Naro needs an access token — the same bearer token your deployment issued (${templates.length} template${templates.length === 1 ? '' : 's'} configured).`),
    h('label', { class: 'field-label', for: 'tok' }, 'Access token'));
  const input = h('input', { class: 'text-input', id: 'tok', type: 'password', placeholder: 'naro_…' });
  const btn = h('button', { class: 'btn-fill', type: 'button', style: 'margin-top:12px' }, 'Continue');
  const save = () => {
    if (input.value.trim() === '') return;
    localStorage.setItem(TOKEN_KEY, input.value.trim());
    location.reload();
  };
  btn.addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  card.append(input, btn);
  col.append(card);
  content.append(col);
}

void boot();
