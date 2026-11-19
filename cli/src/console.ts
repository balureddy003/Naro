/**
 * The `naro serve` ops console — one static, dependency-free HTML page,
 * and the reference implementation *of* `@naro/client`, not a separate
 * thing: every API call below goes through that SDK's `NaroClient` and
 * headless primitives (`watchRun`, `pollRuns`, `pollApprovals`) rather
 * than hand-rolled `fetch` calls, so a custom dashboard built on the same
 * package gets the same behavior (resumable event streaming, reconnect
 * on drop) for free.
 *
 * Read-only except for answering approvals (POST /approvals/:id, which the
 * control plane already gates behind the `approver` role). No build step,
 * no external CDN, no framework: matches the rest of this package running
 * straight from TypeScript source with native type-stripping — the browser
 * loads `@naro/client`'s compiled ESM directly from GET /client/*.js, no
 * bundler in between. The bearer token lives in the browser (localStorage)
 * and is sent as an `Authorization` header on every API call this page
 * makes — it is never embedded in the page itself, so serving the page
 * needs no auth (like /health), while every call it makes is gated
 * exactly like a curl script carrying the same token would be.
 */
export const CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Naro — Ops Console</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280; --border: #e5e7eb;
    --accent: #2563eb; --danger: #dc2626; --ok: #16a34a; --warn: #d97706;
    --panel: #f9fafb; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0b0f17; --fg: #e5e7eb; --muted: #9ca3af; --border: #263041; --panel: #121826; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  header { display: flex; align-items: center; gap: .75rem; padding: .75rem 1rem; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  header h1 { font-size: 1rem; margin: 0; white-space: nowrap; }
  header input { font: inherit; padding: .4rem .5rem; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--fg); }
  header input[type=text] { flex: 1; min-width: 12rem; }
  header input[type=url] { min-width: 14rem; }
  button { font: inherit; padding: .4rem .7rem; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--fg); cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
  button.small { padding: .2rem .5rem; font-size: .78rem; }
  #status { font-size: .8rem; color: var(--muted); }
  main { display: grid; grid-template-columns: minmax(280px, 1fr) 2fr; gap: 1rem; padding: 1rem; align-items: start; }
  @media (max-width: 800px) { main { grid-template-columns: 1fr; } }
  section { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  section > h2 { font-size: .85rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0; padding: .6rem .8rem; border-bottom: 1px solid var(--border); background: var(--panel); display: flex; justify-content: space-between; align-items: center; }
  .list { max-height: 60vh; overflow: auto; }
  .row { padding: .6rem .8rem; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; flex-direction: column; gap: .15rem; }
  .row:last-child { border-bottom: none; }
  .row:hover { background: var(--panel); }
  .row.selected { background: var(--panel); box-shadow: inset 3px 0 0 var(--accent); }
  .row .top { display: flex; justify-content: space-between; gap: .5rem; }
  .row .goal { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { font-size: .72rem; padding: .1rem .45rem; border-radius: 999px; border: 1px solid var(--border); white-space: nowrap; }
  .badge.completed, .badge.permitted, .badge.approved, .badge.ok-true { color: var(--ok); border-color: var(--ok); }
  .badge.failed, .badge.cancelled, .badge.denied, .badge.ok-false { color: var(--danger); border-color: var(--danger); }
  .badge.running, .badge.executed { color: var(--accent); border-color: var(--accent); }
  .badge.paused, .badge.unresolved { color: var(--warn); border-color: var(--warn); }
  .empty { padding: 1rem .8rem; color: var(--muted); }
  #detail { min-height: 70vh; }
  #detailHead { padding: .8rem; border-bottom: 1px solid var(--border); }
  #detailHead .goal { font-weight: 600; margin-bottom: .25rem; word-break: break-word; }
  #detailMeta { color: var(--muted); font-size: .8rem; display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
  #evidence { padding: .6rem .8rem; }
  .chain-line { font-size: .8rem; color: var(--muted); margin-bottom: .6rem; }
  .action-card { border: 1px solid var(--border); border-radius: 6px; padding: .5rem .6rem; margin-bottom: .5rem; font-size: .82rem; }
  .action-card .row1 { display: flex; justify-content: space-between; gap: .5rem; align-items: baseline; }
  .action-card code { font-family: var(--mono); }
  .action-card .detail-line { color: var(--muted); margin-top: .25rem; }
  .action-card .detail-line.error { color: var(--danger); }
  details.raw-events { border-top: 1px solid var(--border); }
  details.raw-events summary { cursor: pointer; padding: .5rem .8rem; color: var(--muted); font-size: .82rem; user-select: none; }
  #events { max-height: 40vh; overflow: auto; padding: .5rem .8rem; font-family: var(--mono); font-size: .76rem; }
  .ev { padding: .2rem 0; border-bottom: 1px dashed var(--border); }
  .ev .type { color: var(--accent); font-weight: 600; }
  .ev .seq { color: var(--muted); }
  .ev pre { margin: .2rem 0 0; white-space: pre-wrap; word-break: break-word; color: var(--fg); }
  .events-note { color: var(--muted); font-size: .74rem; padding: .3rem .8rem; }
  .approval { padding: .6rem .8rem; border-bottom: 1px solid var(--border); }
  .approval:last-child { border-bottom: none; }
  .approval .q { margin-bottom: .4rem; }
  .approval .actions { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; }
  .approval input[type=text] { flex: 1; min-width: 8rem; font: inherit; padding: .3rem .4rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); }
</style>
</head>
<body>
<header>
  <h1>Naro — Ops Console</h1>
  <input id="base" type="url" placeholder="http://localhost:8080" />
  <input id="token" type="text" placeholder="bearer token (optional)" />
  <button id="connect" class="primary">Connect</button>
  <span id="status"></span>
</header>
<main>
  <div style="display:flex; flex-direction:column; gap:1rem;">
    <section>
      <h2><span id="runsTitle">Runs</span><button id="clearTraceFilter" class="small" style="display:none">✕ trace filter</button></h2>
      <div id="runs" class="list"><div class="empty">not connected</div></div>
    </section>
    <section>
      <h2>Approvals</h2>
      <div id="approvals" class="list"><div class="empty">not connected</div></div>
    </section>
  </div>
  <section id="detail">
    <div id="detailHead"><span class="empty">select a run</span></div>
    <div id="evidence"></div>
    <details class="raw-events">
      <summary>Raw events</summary>
      <div class="events-note">Showing the most recent 500 events. The evidence tree above is the correlated view — this is the wire-level trail.</div>
      <div id="events"></div>
    </details>
  </section>
</main>
<script type="module">
import { NaroClient, pollApprovals, pollRuns, watchRun } from '/client/index.js';

const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const badgeClass = (status) => 'badge ' + status;

const MAX_RENDERED_EVENTS = 500; // bounded ring buffer, not full virtual scrolling — see README

let client = null;
let selectedRunId = null;
let traceFilter = null;
let lastRuns = [];
let stopWatchingEvents = null;
let stopPollingRuns = null;
let stopPollingApprovals = null;
let evidenceRefreshTimer = null;

function setStatus(text, isError) {
  const s = el('status');
  s.textContent = text;
  s.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function renderRuns(runs) {
  lastRuns = runs;
  const out = el('runs');
  if (!runs.length) { out.innerHTML = '<div class="empty">no runs yet</div>'; return; }
  out.innerHTML = runs.map((r) => {
    const sel = selectedRunId === r.runId ? ' selected' : '';
    return '<div class="row' + sel + '" data-run="' + esc(r.runId) + '">' +
      '<div class="top"><strong>' + esc(r.runId) + '</strong><span class="' + badgeClass(r.status) + '">' + esc(r.status) + '</span></div>' +
      '<div class="goal">' + esc(r.goal || '') + '</div>' +
      '</div>';
  }).join('');
  for (const row of out.querySelectorAll('.row')) {
    row.addEventListener('click', () => selectRun(row.getAttribute('data-run')));
  }
}

function renderApprovals(list) {
  const out = el('approvals');
  if (!list.length) { out.innerHTML = '<div class="empty">no pending approvals</div>'; return; }
  out.innerHTML = list.map((a) => (
    '<div class="approval" data-id="' + esc(a.id) + '">' +
    '<div class="q">' + esc(a.question) + '</div>' +
    '<div class="actions">' +
    (a.kind === 'approve'
      ? '<button class="primary" data-act="approve">Approve</button><button class="danger" data-act="deny">Deny</button>'
      : '<input type="text" placeholder="answer" /><button class="primary" data-act="answer">Send</button>') +
    '<input type="text" class="note" placeholder="note (optional)" />' +
    '</div></div>'
  )).join('');
  for (const card of out.querySelectorAll('.approval')) {
    const id = card.getAttribute('data-id');
    for (const btn of card.querySelectorAll('button')) {
      btn.addEventListener('click', async () => {
        const act = btn.getAttribute('data-act');
        const note = card.querySelector('.note').value || undefined;
        const body = { note };
        if (act === 'approve') body.approved = true;
        else if (act === 'deny') body.approved = false;
        else body.text = card.querySelector('input[type=text]').value;
        try {
          await client.answerApproval(id, body);
          // Don't wait for the next 3s poll — an answered request left
          // visible invites a second, redundant click on it.
          client.listApprovals().then(renderApprovals).catch(() => {});
        } catch (e) {
          setStatus('approval failed: ' + e.message, true);
        }
      });
    }
  }
}

function renderEvidence(record) {
  const chain = record.chain;
  const parts = [
    'chain: ' + (chain.ok ? 'intact' : 'BROKEN') + ' (' + chain.length + ' events' + (chain.unchained ? ', ' + chain.unchained + ' unchained' : '') + ')',
  ];
  if (record.goalVerification) parts.push('goal verified: ' + record.goalVerification.ok + (record.goalVerification.verifier ? ' by ' + esc(record.goalVerification.verifier) : ''));
  if (record.outcome) parts.push('outcome: ' + record.outcome.status);
  const header = '<div class="chain-line">' + parts.join(' &middot; ') + '</div>';

  if (!record.actions.length) {
    el('evidence').innerHTML = header + '<div class="empty">no actions yet</div>';
    return;
  }
  const cards = record.actions.map((a) => {
    const lines = [];
    if (a.observation) {
      lines.push('<div class="detail-line' + (a.observation.success ? '' : ' error') + '">' +
        (a.observation.success ? 'observed' : 'observation failed: ' + esc(a.observation.error || '')) + '</div>');
    }
    if (a.verification) {
      lines.push('<div class="detail-line' + (a.verification.ok ? '' : ' error') + '">' +
        'verified: ' + a.verification.ok + (a.verification.reason ? ' — ' + esc(a.verification.reason) : '') +
        (a.verification.verifier ? ' (' + esc(a.verification.verifier) + ')' : '') + '</div>');
    }
    if (a.deniedReason) lines.push('<div class="detail-line error">denied: ' + esc(a.deniedReason) + '</div>');
    if (a.approvedBy) lines.push('<div class="detail-line">approved by ' + esc(a.approvedBy) + '</div>');
    return '<div class="action-card">' +
      '<div class="row1"><code>' + esc(a.capability) + '</code>' +
      '<span class="' + badgeClass(a.policy) + '">' + esc(a.policy) + '</span></div>' +
      lines.join('') + '</div>';
  }).join('');
  el('evidence').innerHTML = header + cards;
}

function refreshEvidence(runId) {
  if (evidenceRefreshTimer) return; // already scheduled — coalesce bursts of events
  evidenceRefreshTimer = setTimeout(async () => {
    evidenceRefreshTimer = null;
    if (runId !== selectedRunId) return; // selection changed while we waited
    try {
      renderEvidence(await client.getEvidence(runId));
    } catch (e) {
      // A run with no actions yet 404s on evidence before its first
      // action — not an error worth surfacing.
    }
  }, 400);
}

function appendEventRow(e) {
  const container = el('events');
  const div = document.createElement('div');
  div.className = 'ev';
  div.innerHTML = '<span class="seq">#' + e.seq + '</span> <span class="type">' + esc(e.type) + '</span>' +
    '<pre>' + esc(JSON.stringify(e.data)) + '</pre>';
  container.appendChild(div);
  while (container.children.length > MAX_RENDERED_EVENTS) container.removeChild(container.firstChild);
  container.scrollTop = container.scrollHeight;
}

function selectRun(runId) {
  selectedRunId = runId;
  renderRuns(lastRuns);
  el('events').innerHTML = '';
  el('evidence').innerHTML = '';
  if (stopWatchingEvents) { stopWatchingEvents(); stopWatchingEvents = null; }

  client.getRun(runId).then((r) => {
    el('detailHead').innerHTML =
      '<div class="goal">' + esc(r.goal) + '</div>' +
      '<div id="detailMeta">' + esc(runId) + ' &middot; <span class="' + badgeClass(r.status) + '">' + esc(r.status) + '</span>' +
      (r.result !== undefined ? ' &middot; result: <code>' + esc(JSON.stringify(r.result)) + '</code>' : '') +
      (r.error ? ' &middot; error: ' + esc(r.error) : '') +
      (r.traceId ? ' &middot; trace <code>' + esc(r.traceId) + '</code> <button id="showTrace" class="small">show all runs in this trace</button>' : '') +
      '</div>';
    const showTrace = el('showTrace');
    if (showTrace) showTrace.addEventListener('click', () => setTraceFilter(r.traceId));
  }).catch((e) => setStatus('run lookup failed: ' + e.message, true));

  refreshEvidence(runId);
  stopWatchingEvents = watchRun(client, runId, {
    onEvent: (e) => {
      appendEventRow(e);
      refreshEvidence(runId);
    },
    onError: (e) => setStatus('event stream: reconnecting after ' + e.message, true),
  });
}

function setTraceFilter(traceId) {
  traceFilter = traceId;
  el('runsTitle').textContent = 'Runs — trace ' + traceId;
  el('clearTraceFilter').style.display = '';
  restartRunPolling();
}

function clearTraceFilter() {
  traceFilter = null;
  el('runsTitle').textContent = 'Runs';
  el('clearTraceFilter').style.display = 'none';
  restartRunPolling();
}
el('clearTraceFilter').addEventListener('click', clearTraceFilter);

function restartRunPolling() {
  if (stopPollingRuns) stopPollingRuns();
  stopPollingRuns = pollRuns(client, {
    intervalMs: 3000,
    ...(traceFilter ? { traceId: traceFilter } : {}),
    onData: (runs) => { renderRuns(runs); setStatus('connected'); },
    onError: (e) => setStatus('runs: ' + e.message, true),
  });
}

el('connect').addEventListener('click', () => {
  const baseUrl = (el('base').value || location.origin).replace(/\\/$/, '');
  const token = el('token').value.trim() || undefined;
  localStorage.setItem('naro-console-base', baseUrl);
  localStorage.setItem('naro-console-token', token || '');

  client = new NaroClient({ baseUrl, token });
  if (stopPollingRuns) stopPollingRuns();
  if (stopPollingApprovals) stopPollingApprovals();
  clearTraceFilter();
  restartRunPolling();
  stopPollingApprovals = pollApprovals(client, {
    intervalMs: 3000,
    onData: renderApprovals,
    onError: () => { el('approvals').innerHTML = '<div class="empty">approvals not configured on this server</div>'; },
  });
});

// Convenience only — this is per-browser storage, never sent anywhere but
// back to the base URL the viewer typed in themselves.
const savedBase = localStorage.getItem('naro-console-base');
const savedToken = localStorage.getItem('naro-console-token');
el('base').value = savedBase || location.origin;
if (savedToken) el('token').value = savedToken;
</script>
</body>
</html>
`;
