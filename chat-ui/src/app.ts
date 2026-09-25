import { sdk } from './sdk.ts';
import { h, clear } from './dom.ts';
import { icon } from './icons.ts';
import { disposeAll } from './lifecycle.ts';
import { runStatusLabel, errText } from './copy.ts';
import { renderRun } from './chat.ts';
import { renderSystemPage, renderSettingsTab, renderAccessTab, openWizard, type PageDeps } from './pages.ts';
import { toast } from './toast.ts';
import { installPalette, openPalette, type PaletteDeps } from './palette.ts';
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
  /** Which sign-out path the sidebar's account menu should use — an
   *  accounts-enabled deployment calls POST /accounts/logout; a
   *  self-hosted one just clears the localStorage token. */
  accountsEnabled: boolean;
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
    h('div', { style: 'min-width:0;flex:1' },
      h('div', { class: 'workspace-name' }, 'Naro'),
      h('div', { class: 'workspace-sub' }, `signed in as ${state.me.id}`)));
  if (!state.me.open) {
    const signOut = h('button', { class: 'gear-btn', type: 'button', 'aria-label': 'Sign out', title: 'Sign out' }, icon('logout'));
    signOut.addEventListener('click', () => void signOutAndReload(state));
    ws.append(signOut);
  }
  head.append(ws);
  head.append(h('span', { class: 'self-host-badge' }, state.accountsEnabled ? 'naro serve' : 'self‑hosted · naro serve'));
  if (state.me.roles.has('admin')) {
    const newBtn = h('button', { class: 'new-btn', type: 'button' }, '+ New template');
    newBtn.addEventListener('click', () => openWizard(deps()));
    head.append(newBtn);
  }
  // ⌘K affordance — the palette exists whether or not the user knows the
  // shortcut; a visible trigger is how they find out.
  const palTrigger = h('button', { class: 'new-btn', type: 'button', style: 'display:flex;align-items:center;gap:8px;color:var(--ink-faint);margin-top:8px' },
    h('span', {}, 'Search or jump to…'), h('span', { class: 'kbd', style: 'margin-left:auto' }, '⌘K'));
  palTrigger.addEventListener('click', () => openPalette(paletteDeps));
  head.append(palTrigger);
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
      h('span', { class: 'tmpl-caret' }, icon('caret')),
      h('span', { class: 'tmpl-icon' }, (t.icon ?? t.name.slice(0, 2)).toUpperCase()),
      h('span', { class: 'tmpl-name' }, t.name));
    headRow.addEventListener('click', () => { location.hash = `#/t/${t.id}/runs`; });
    if (isAdmin) {
      const gear = h('button', { class: 'gear-btn', type: 'button', 'aria-label': `${t.name} settings` }, icon('gear'));
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

async function signOutAndReload(state: AppState): Promise<void> {
  if (state.accountsEnabled) {
    try { await fetch(`${location.origin}/accounts/logout`, { method: 'POST' }); } catch { /* best effort — reload re-checks anyway */ }
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
  location.reload();
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
  const menu = h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'Menu' }, icon('menu'));
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
    renderFirstRun(d, col, t);
  } else {
    await renderRunInto(col, list[0]!, t);
  }
  mountComposer(state, t);
}

async function renderRunInto(col: HTMLElement, run: RunSummary, t?: ChatTemplate): Promise<void> {
  clear(col);
  await renderRun(deps(), col, run, t);
}

/**
 * First-run checklist — a new admin staring at "waiting for its first
 * trigger" gets three real next steps, each linked to the actual action.
 * Items check themselves off from observable state (not optimistic
 * localStorage ticks): a template exists, a teammate principal exists,
 * a run exists. Dismissed permanently per browser.
 */
const FIRSTRUN_KEY = 'naro.chat.firstrun.dismissed';

function renderFirstRun(d: PageDeps, col: HTMLElement, t: ChatTemplate): void {
  if (!d.me.roles.has('admin')) return;
  if (localStorage.getItem(FIRSTRUN_KEY) === '1') return;
  if (state.runs.length > 0) return;

  const card = h('div', { class: 'firstrun' });
  const dismiss = h('button', { class: 'firstrun-dismiss', type: 'button' }, 'Dismiss');
  dismiss.addEventListener('click', () => { localStorage.setItem(FIRSTRUN_KEY, '1'); card.remove(); });
  card.append(dismiss, h('h3', {}, 'Get started'), h('p', { class: 'fr-sub' }, 'Three steps — each is a real action, not a tour.'));

  const item = (done: boolean, label: string, go: () => void) => {
    const b = h('button', { class: `firstrun-item${done ? ' done' : ''}`, type: 'button' },
      h('span', { class: 'box' }, done ? '✓' : ''),
      h('span', { class: 'fr-link' }, label));
    b.addEventListener('click', () => { if (!done) go(); });
    card.append(b);
  };

  item(state.templates.some((x) => isConfigured(state, x)), 'Configure your first template', () => { location.hash = `#/t/${t.id}/settings`; });
  const inviteItem = h('button', { class: 'firstrun-item', type: 'button' },
    h('span', { class: 'box' }), h('span', { class: 'fr-link' }, 'Invite a teammate — issue their access token'));
  inviteItem.addEventListener('click', () => { location.hash = `#/t/${t.id}/access`; });
  card.append(inviteItem);
  // Check "teammate invited" against the real principal list — not a
  // remembered click. If the store isn't configured (501), the item
  // stays unchecked; it can't be proven done, so we don't claim it.
  void d.client.listPrincipals()
    .then((rows) => { if (rows.length > 1) { inviteItem.classList.add('done'); inviteItem.querySelector('.box')!.textContent = '✓'; } })
    .catch(() => {});
  item(false, 'Send a test goal — watch it verify itself', () => {
    (document.querySelector('.composer textarea') as HTMLElement | null)?.focus();
  });
  col.append(card);
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
    // Optimistic: the message lands in the transcript now, dimmed while
    // the server catches up — and rolls back to a failed bubble + toast
    // if it never does.
    const content = document.getElementById('content')!;
    let col = content.querySelector('.column');
    if (col === null) { col = h('div', { class: 'column' }); content.append(col); }
    const bubble = h('div', { class: 'msg-user pending' }, text);
    const pending = h('div', { class: 'msg-assistant' }, h('div', { class: 'dots' }, h('span'), h('span'), h('span')));
    col.append(bubble, pending);
    bubble.scrollIntoView({ block: 'nearest' });
    ta.value = '';
    send.setAttribute('disabled', '');
    try {
      const { runId } = await state.client.submitGoal({ description: text, template: t.id });
      location.hash = `#/t/${t.id}/runs/run/${encodeURIComponent(runId)}`;
      await refresh(state);
    } catch (e) {
      bubble.classList.remove('pending');
      bubble.classList.add('failed');
      pending.remove();
      toast(e instanceof Error ? errText(e) : 'Failed to send — the goal never reached the server', 'danger');
      ta.value = text; // restore the draft — a failed send mustn't eat it
    } finally {
      send.removeAttribute('disabled');
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
const paletteDeps = (): PaletteDeps => ({
  ...deps(), runs: state.runs, isAdmin: state.me.roles.has('admin'),
  signOut: () => void signOutAndReload(state),
  openWizard: () => openWizard(deps()),
});

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
  const cfg = (window as unknown as { NARO_CHAT_CONFIG?: { templates?: ChatTemplate[]; accountsEnabled?: boolean } }).NARO_CHAT_CONFIG ?? {};
  const templates = cfg.templates ?? [];
  const accountsEnabled = cfg.accountsEnabled === true;

  // ADR 0027: an accounts-enabled deployment authenticates via the
  // session cookie the browser already sends on every same-origin
  // request — no token to read from localStorage at all. A self-hosted
  // deployment keeps the exact token-in-localStorage path unchanged.
  const token = accountsEnabled ? undefined : (localStorage.getItem(TOKEN_KEY) ?? undefined);
  const client = new sdk.NaroClient({ baseUrl: location.origin, ...(token !== undefined && { token }) });

  let me: AppState['me'];
  try {
    const m = await client.me();
    me = { id: m.id, roles: new Set(m.roles), ...(m.tenantId !== undefined && { tenantId: m.tenantId }), ...(m.open === true && { open: true }) };
  } catch {
    if (accountsEnabled) renderAccountAuth(templates);
    else renderTokenSignIn(templates);
    return;
  }

  state = { client, me, templates, runs: [], approvals: [], accountsEnabled };
  // Skeleton before the first /runs + /approvals land — the shell's
  // frame is instant, the data isn't; a shimmer beats a blank column.
  const content = document.getElementById('content')!;
  const bootCol = h('div', { class: 'column' });
  for (const cls of ['sk sk-msg', 'sk sk-card', 'sk sk-chip', 'sk sk-card']) bootCol.append(h('div', { class: cls }));
  content.append(bootCol);

  await refresh(state);
  window.addEventListener('hashchange', () => void render());
  installPalette(paletteDeps);
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

/**
 * The front door, shared by both auth modes. Split layout: a hero panel
 * tells the deployment's one true story (no marketing — every line is a
 * verifiable property of this binary), the form panel collects proof of
 * identity. `hero` copy differs by mode only where the truth differs:
 * self-hosted deployments hold keys in files the operator passed;
 * accounts-enabled ones hold sessions.
 */
function authScaffold(
  content: HTMLElement,
  lede: string,
  points: [Parameters<typeof icon>[0], string, string][],
): { col: HTMLElement; panel: HTMLElement; help: HTMLElement } {
  document.querySelector('.app')!.classList.add('auth');
  clear(content);
  const col = h('div', { class: 'signin' });
  const hero = h('div', { class: 'signin-hero' },
    h('div', { class: 'hero-mark' }, icon('shield')),
    h('h1', { class: 'hero-title' }, 'Naro'),
    h('p', { class: 'hero-lede' }, lede),
    h('div', { class: 'hero-points' },
      ...points.map(([ic, strong, sub]) => h('div', { class: 'hero-point' },
        icon(ic), h('span', {}, h('strong', {}, strong), sub)))));
  const panel = h('div', { class: 'signin-panel' });
  col.append(h('div', { class: 'signin-split' }, hero, panel));
  const help = h('div', { class: 'signin-help' });
  content.append(col);
  return { col, panel, help };
}

const ERR_HIDE = { style: 'display:none' } as const;
function authError(msg: string): HTMLElement {
  return h('p', { class: 'signin-err' }, icon('alert'), h('span', {}, msg));
}
function showErr(slot: HTMLElement, msg: string): void {
  const el = authError(msg);
  slot.replaceWith(el);
}

/** Password input with a show/hide toggle — the standard affordance. */
function passwordField(id: string, autocomplete: string, mono = false): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { class: `text-input${mono ? ' mono' : ''}`, id, type: 'password', autocomplete }) as HTMLInputElement;
  const wrap = h('div', { class: 'pw-wrap' }, input);
  const toggle = h('button', { class: 'pw-toggle', type: 'button', 'aria-label': 'Show password', title: 'Show password' }, icon('eye'));
  toggle.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    toggle.replaceChildren(icon(showing ? 'eye' : 'eyeoff'));
    toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });
  wrap.append(toggle);
  return { wrap, input };
}

/** The self-hosted sign-in screen — no self-service registration by
 *  design (ADR 0012/0025, admin-issued tokens, same posture as Grafana
 *  or Metabase's own admin-invites-you model). The form collects the
 *  token; the hero says what this deployment actually is. */
function renderTokenSignIn(templates: ChatTemplate[]): void {
  const content = document.getElementById('content')!;
  const { col, panel, help } = authScaffold(content,
    templates.length > 0
      ? `${templates.length} outcome template${templates.length === 1 ? '' : 's'} configured on this deployment. Sign in to see them work.`
      : 'A self-hosted control plane for agents whose actions are checked and whose records verify.',
    [
      ['lock', 'Self-hosted', 'This page is served by your own naro serve — nothing leaves the machine.'],
      ['shield', 'Policy-checked', 'Every action an agent takes passes policy before it runs.'],
      ['link', 'Provable', 'Each run leaves a hash-chained journal you can verify, not a log you have to trust.'],
    ]);

  panel.append(h('h1', { class: 'signin-title' }, 'Sign in'));
  panel.append(h('p', { class: 'signin-sub' }, 'Access is admin-issued — there are no accounts on a self-hosted deployment, by design.'));
  panel.append(h('label', { class: 'field-label', for: 'tok' }, 'Access token'));
  const { wrap, input } = passwordField('tok', 'off', true);
  input.setAttribute('placeholder', 'naro_…');
  input.setAttribute('spellcheck', 'false');
  panel.append(wrap);
  const errSlot = h('p', ERR_HIDE);
  panel.append(errSlot);
  const btn = h('button', { class: 'btn-fill signin-btn', type: 'button' }, icon('arrow', 'btn-icon'), 'Continue');
  panel.append(btn);

  const save = () => {
    const v = input.value.trim();
    if (v === '') { showErr(errSlot, 'Enter a token to continue.'); input.focus(); return; }
    localStorage.setItem(TOKEN_KEY, v);
    location.reload();
  };
  btn.addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  input.addEventListener('input', () => { errSlot.querySelector('.signin-err')?.remove(); });

  help.append(
    h('p', {},
      h('strong', {}, 'Setting this up for the first time? '),
      "You already have a token — it's the one you passed to naro serve with ",
      h('code', {}, '--principals'), ' or ', h('code', {}, '--token'), ' when you started it.'),
    h('p', {},
      h('strong', {}, 'Someone gave you access? '),
      "Use the token they shared with you — it's issued to you personally and works the moment they generate it, no invite email, no password to set."));
  col.append(help);
  col.append(h('div', { class: 'signin-foot' }, icon('shield'), 'naro serve — policy-checked · provable · self-hosted'));
  input.focus();
}

/**
 * ADR 0027's hosted signup/login — real email + password, a session
 * cookie on success, no token the visitor ever sees or copies. One
 * screen, a tab toggle between the two modes (defaulting to Sign up,
 * the first thing a new visitor to a hosted product needs) rather than
 * two separate routes, since the fields and submit mechanics are nearly
 * identical and a mis-click between them should be one tap to fix, not
 * a navigation.
 */
/**
 * ADR 0027's hosted signup/login — real email + password, a session
 * cookie on success, no token the visitor ever sees or copies. One
 * screen, a tab toggle between the two modes (defaulting to Sign up,
 * the first thing a new visitor to a hosted product needs).
 */
function renderAccountAuth(templates: ChatTemplate[]): void {
  const content = document.getElementById('content')!;
  const { col, panel, help } = authScaffold(content,
    templates.length > 0
      ? `${templates.length} outcome template${templates.length === 1 ? '' : 's'} configured on this deployment. Sign up to see them work.`
      : 'A control plane for agents whose actions are checked and whose records verify.',
    [
      ['shield', 'Policy-checked', 'Every action an agent takes passes policy before it runs.'],
      ['link', 'Provable', 'Each run leaves a hash-chained journal you can verify, not a log you have to trust.'],
      ['key', 'Sessions, not tokens', 'Your browser holds a session cookie — you never see or copy a bearer token.'],
    ]);

  let mode: 'signup' | 'login' = 'signup';

  const title = h('h1', { class: 'signin-title' });
  const sub = h('p', { class: 'signin-sub' });
  const tabs = h('div', { class: 'auth-tabs' },
    h('button', { class: 'auth-tab', type: 'button' }, 'Sign up'),
    h('button', { class: 'auth-tab', type: 'button' }, 'Log in'));

  const emailInput = h('input', { class: 'text-input', type: 'email', placeholder: 'you@company.com', autocomplete: 'email' }) as HTMLInputElement;
  const pw = passwordField('auth-password', 'current-password');
  const passwordHint = h('p', { class: 'field-hint' }, 'At least 10 characters.');
  const errSlot = h('p', ERR_HIDE);
  const btn = h('button', { class: 'btn-fill signin-btn', type: 'button' });
  const btnIcon = h('span', {});
  const btnLabel = h('span', {});
  btn.append(btnIcon, btnLabel);

  panel.append(title, sub, tabs,
    h('label', { class: 'field-label' }, 'Email'), emailInput,
    h('label', { class: 'field-label', style: 'margin-top:14px' }, 'Password'), pw.wrap, passwordHint,
    errSlot, btn);

  const applyMode = () => {
    errSlot.querySelector('.signin-err')?.remove();
    tabs.children[0]!.classList.toggle('active', mode === 'signup');
    tabs.children[1]!.classList.toggle('active', mode === 'login');
    title.textContent = mode === 'signup' ? 'Create your account' : 'Welcome back';
    sub.textContent = mode === 'signup'
      ? 'The first account on this deployment becomes its admin.'
      : 'Log in with your email and password.';
    pw.input.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
    passwordHint.style.display = mode === 'signup' ? '' : 'none';
    btnIcon.replaceChildren(icon('arrow', 'btn-icon'));
    btnLabel.textContent = mode === 'signup' ? 'Create account' : 'Log in';
    clear(help);
    help.append(mode === 'signup'
      ? h('p', {}, "You're in immediately — no email verification yet, this is a v1. Signing up makes you this deployment's first admin.")
      : h('p', {}, h('strong', {}, "Don't have an account? "), 'Use the "Sign up" tab above — anyone can create the first account on a fresh deployment.'));
  };

  tabs.children[0]!.addEventListener('click', () => { mode = 'signup'; applyMode(); emailInput.focus(); });
  tabs.children[1]!.addEventListener('click', () => { mode = 'login'; applyMode(); emailInput.focus(); });

  const setBusy = (busy: boolean) => {
    if (busy) {
      btn.setAttribute('disabled', '');
      btnIcon.replaceChildren(h('span', { class: 'spinner' }));
      btnLabel.textContent = mode === 'signup' ? 'Creating account…' : 'Logging in…';
    } else {
      btn.removeAttribute('disabled');
      btnIcon.replaceChildren(icon('arrow', 'btn-icon'));
      btnLabel.textContent = mode === 'signup' ? 'Create account' : 'Log in';
    }
  };

  const submit = async () => {
    const email = emailInput.value.trim();
    const password = pw.input.value;
    errSlot.querySelector('.signin-err')?.remove();
    if (email === '' || password === '') { errSlot.replaceWith(authError('Email and password are both required.')); return; }
    setBusy(true);
    try {
      const res = await fetch(`${location.origin}/accounts/${mode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        errSlot.replaceWith(authError(body.error ?? `${mode === 'signup' ? 'Sign up' : 'Log in'} failed.`));
        return;
      }
      location.reload();
    } catch {
      errSlot.replaceWith(authError('Could not reach the server — check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };
  btn.addEventListener('click', () => void submit());
  for (const field of [emailInput, pw.input]) field.addEventListener('keydown', (e) => { if (e.key === 'Enter') void submit(); });

  applyMode();
  col.append(help);
  col.append(h('div', { class: 'signin-foot' }, icon('shield'), 'naro serve — policy-checked · provable'));
  emailInput.focus();
}

void boot();
