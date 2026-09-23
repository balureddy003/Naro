/**
 * The `naro serve` ops console — one static, dependency-free HTML page.
 *
 * Read-only except for answering approvals (POST /approvals/:id, which the
 * control plane already gates behind the `approver` role). No build step,
 * no external CDN, no framework: matches the rest of this package running
 * straight from TypeScript source with native type-stripping. The bearer
 * token lives in the browser (localStorage) and is sent as an
 * `Authorization` header on every API call this page makes — it is never
 * embedded in the page itself, so serving the page needs no auth (like
 * /health), while every call it makes is gated exactly like a curl script
 * carrying the same token would be.
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
  #status { font-size: .8rem; color: var(--muted); }
  main { display: grid; grid-template-columns: minmax(280px, 1fr) 2fr; gap: 1rem; padding: 1rem; align-items: start; }
  @media (max-width: 800px) { main { grid-template-columns: 1fr; } }
  section { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  section > h2 { font-size: .85rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0; padding: .6rem .8rem; border-bottom: 1px solid var(--border); background: var(--panel); }
  .list { max-height: 70vh; overflow: auto; }
  .row { padding: .6rem .8rem; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; flex-direction: column; gap: .15rem; }
  .row:last-child { border-bottom: none; }
  .row:hover { background: var(--panel); }
  .row.selected { background: var(--panel); box-shadow: inset 3px 0 0 var(--accent); }
  .row .top { display: flex; justify-content: space-between; gap: .5rem; }
  .row .goal { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { font-size: .72rem; padding: .1rem .45rem; border-radius: 999px; border: 1px solid var(--border); white-space: nowrap; }
  .badge.completed { color: var(--ok); border-color: var(--ok); }
  .badge.failed, .badge.cancelled { color: var(--danger); border-color: var(--danger); }
  .badge.running { color: var(--accent); border-color: var(--accent); }
  .badge.paused { color: var(--warn); border-color: var(--warn); }
  .empty { padding: 1rem .8rem; color: var(--muted); }
  #detail { min-height: 70vh; }
  #detailHead { padding: .8rem; border-bottom: 1px solid var(--border); }
  #detailHead .goal { font-weight: 600; margin-bottom: .25rem; word-break: break-word; }
  #detailMeta { color: var(--muted); font-size: .8rem; }
  #events { max-height: 60vh; overflow: auto; padding: .5rem .8rem; font-family: var(--mono); font-size: .78rem; }
  .ev { padding: .25rem 0; border-bottom: 1px dashed var(--border); }
  .ev .type { color: var(--accent); font-weight: 600; }
  .ev .seq { color: var(--muted); }
  .ev pre { margin: .25rem 0 0; white-space: pre-wrap; word-break: break-word; color: var(--fg); }
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
      <h2>Runs</h2>
      <div id="runs" class="list"><div class="empty">not connected</div></div>
    </section>
    <section>
      <h2>Approvals</h2>
      <div id="approvals" class="list"><div class="empty">not connected</div></div>
    </section>
  </div>
  <section id="detail">
    <div id="detailHead"><span class="empty">select a run</span></div>
    <div id="events"></div>
  </section>
</main>
<script>
(function () {
  var state = { base: '', token: '', selected: null, esAbort: null, pollTimer: null };

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); }

  function headers() {
    var h = {};
    if (state.token) h['authorization'] = 'Bearer ' + state.token;
    return h;
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, headers(), opts.headers || {});
    return fetch(state.base + path, opts).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(res.status + ' ' + t); });
      return res.json();
    });
  }

  function setStatus(text, isError) {
    var s = el('status');
    s.textContent = text;
    s.style.color = isError ? 'var(--danger)' : 'var(--muted)';
  }

  function badgeClass(status) { return 'badge ' + status; }

  function renderRuns(runs) {
    var out = el('runs');
    if (!runs.length) { out.innerHTML = '<div class="empty">no runs yet</div>'; return; }
    out.innerHTML = runs.map(function (r) {
      var sel = state.selected === r.runId ? ' selected' : '';
      return '<div class="row' + sel + '" data-run="' + esc(r.runId) + '">' +
        '<div class="top"><strong>' + esc(r.runId) + '</strong><span class="' + badgeClass(r.status) + '">' + esc(r.status) + '</span></div>' +
        '<div class="goal">' + esc(r.goal || '') + '</div>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(out.querySelectorAll('.row'), function (row) {
      row.addEventListener('click', function () { selectRun(row.getAttribute('data-run')); });
    });
  }

  function renderApprovals(list) {
    var out = el('approvals');
    if (!list.length) { out.innerHTML = '<div class="empty">no pending approvals</div>'; return; }
    out.innerHTML = list.map(function (a) {
      return '<div class="approval" data-id="' + esc(a.id) + '">' +
        '<div class="q">' + esc(a.question) + '</div>' +
        '<div class="actions">' +
        (a.kind === 'approve'
          ? '<button class="primary" data-act="approve">Approve</button><button class="danger" data-act="deny">Deny</button>'
          : '<input type="text" placeholder="answer" />' + '<button class="primary" data-act="answer">Send</button>') +
        '<input type="text" class="note" placeholder="note (optional)" />' +
        '</div></div>';
    }).join('');
    Array.prototype.forEach.call(out.querySelectorAll('.approval'), function (card) {
      var id = card.getAttribute('data-id');
      Array.prototype.forEach.call(card.querySelectorAll('button'), function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          var note = card.querySelector('.note').value || undefined;
          var body = { note: note };
          if (act === 'approve') body.approved = true;
          else if (act === 'deny') body.approved = false;
          else body.text = card.querySelector('input[type=text]').value;
          api('/approvals/' + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
            .then(refreshApprovals)
            .catch(function (e) { setStatus('approval failed: ' + e.message, true); });
        });
      });
    });
  }

  function selectRun(runId) {
    state.selected = runId;
    renderRuns(lastRuns || []);
    api('/runs/' + runId).then(function (r) {
      el('detailHead').innerHTML =
        '<div class="goal">' + esc(r.goal) + '</div>' +
        '<div id="detailMeta">' + esc(runId) + ' &middot; <span class="' + badgeClass(r.status) + '">' + esc(r.status) + '</span>' +
        (r.result !== undefined ? ' &middot; result: <code>' + esc(JSON.stringify(r.result)) + '</code>' : '') +
        (r.error ? ' &middot; error: ' + esc(r.error) : '') + '</div>';
    }).catch(function (e) { setStatus('run lookup failed: ' + e.message, true); });

    if (state.esAbort) { state.esAbort.abort(); state.esAbort = null; }
    el('events').innerHTML = '';
    streamEvents(runId);
  }

  // The bearer token gates this endpoint like any other — the browser's
  // built-in EventSource can't set an Authorization header, and a token in
  // the URL would leak into access logs and history, so this reads the SSE
  // stream by hand over a plain authenticated fetch() instead.
  function streamEvents(runId) {
    var ctrl = new AbortController();
    state.esAbort = ctrl;
    fetch(state.base + '/runs/' + runId + '/events', { headers: headers(), signal: ctrl.signal })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error('events: ' + res.status);
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buf = '';
        function pump() {
          return reader.read().then(function (step) {
            if (step.done) return;
            buf += decoder.decode(step.value, { stream: true });
            var lines = buf.split('\\n');
            buf = lines.pop() || '';
            lines.forEach(function (line) {
              if (line.indexOf('data:') !== 0) return;
              var e;
              try { e = JSON.parse(line.slice(5)); } catch (_e) { return; }
              var div = document.createElement('div');
              div.className = 'ev';
              div.innerHTML = '<span class="seq">#' + e.seq + '</span> <span class="type">' + esc(e.type) + '</span>' +
                '<pre>' + esc(JSON.stringify(e.data, null, 0)) + '</pre>';
              el('events').appendChild(div);
              el('events').scrollTop = el('events').scrollHeight;
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function (e) { if (e.name !== 'AbortError') setStatus('event stream: ' + e.message, true); });
  }

  var lastRuns = [];
  function refreshRuns() {
    api('/runs').then(function (runs) { lastRuns = runs; renderRuns(runs); setStatus('connected'); })
      .catch(function (e) { setStatus('runs: ' + e.message, true); });
  }
  function refreshApprovals() {
    api('/approvals').then(renderApprovals).catch(function () { /* 501 when no bridge configured — quietly empty */
      el('approvals').innerHTML = '<div class="empty">approvals not configured on this server</div>';
    });
  }

  el('connect').addEventListener('click', function () {
    state.base = (el('base').value || location.origin).replace(/\\/$/, '');
    state.token = el('token').value.trim();
    localStorage.setItem('naro-console-base', state.base);
    localStorage.setItem('naro-console-token', state.token);
    if (state.pollTimer) clearInterval(state.pollTimer);
    refreshRuns();
    refreshApprovals();
    state.pollTimer = setInterval(function () { refreshRuns(); refreshApprovals(); }, 3000);
  });

  // Convenience only — this is per-browser storage, never sent anywhere
  // but back to the base URL the viewer typed in themselves.
  var savedBase = localStorage.getItem('naro-console-base');
  var savedToken = localStorage.getItem('naro-console-token');
  if (savedBase) el('base').value = savedBase;
  else el('base').value = location.origin;
  if (savedToken) el('token').value = savedToken;
})();
</script>
</body>
</html>
`;
