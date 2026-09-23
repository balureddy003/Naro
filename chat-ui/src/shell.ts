/**
 * The chat UI shell — one static HTML page, no framework, no CDN, same
 * serving posture as the ops console (GET /chat needs no auth; every API
 * call the page makes is gated normally). The app itself is compiled ESM
 * under /chat-ui/*.js; the SDK comes from /client/index.js.
 *
 * `__NARO_CHAT_CONFIG__` is substituted server-side at serve time with
 * the deployment's template manifest (ServeOptions.chatTemplates) — a
 * sidebar can't derive "which templates exist" from runs alone, and a
 * config literal in the page means no extra endpoint to expose it.
 *
 * Visual language follows docs/product/prd-006-mockup.html: IBM Plex
 * Sans/Mono (the one external dependency this page has — everything else
 * is inline, matching the console's zero-CDN posture except this single,
 * deliberate typography choice), three semantic colors (accent=verified,
 * warn=needs-review, danger=denied), one shell, sidebar-of-objects,
 * expandable template groups, a restrained one-tier shadow system for
 * elevation (cards/overlays only — flat surfaces stay flat, per the
 * mockup's "not everything is a card" rule).
 */
export const CHAT_UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Naro</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root {
    color-scheme: light dark;
    --font-sans: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
    --bg: #f2f4f0; --sidebar-bg: #ecefe7; --surface: #ffffff; --surface-alt: #f6f7f3;
    --ink: #1b231f; --ink-muted: #4e5a53; --ink-faint: #5f6b64;
    --border: #d7dbd0; --border-soft: #e4e7de;
    --accent: #0f6e5c; --accent-ink: #ffffff; --accent-soft: #e3efe9; --accent-soft-border: #c3d9ce;
    --warn: #96590a; --warn-soft: #f6ecdd; --warn-soft-border: #e6d2b3;
    --danger: #96341f; --danger-soft: #f7e7e2; --danger-soft-border: #e8c5ba;
    --focus: #0f6e5c; --overlay: rgba(20,24,20,.35);
    --shadow-sm: 0 1px 2px rgba(24,30,26,.05), 0 1px 1px rgba(24,30,26,.04);
    --shadow-md: 0 8px 24px rgba(24,30,26,.10), 0 2px 6px rgba(24,30,26,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #121613; --sidebar-bg: #0e120f; --surface: #1a201c; --surface-alt: #212722;
      --ink: #e9ece7; --ink-muted: #a2aca4; --ink-faint: #8a938c;
      --border: #303a33; --border-soft: #262f29;
      --accent: #4fd6b6; --accent-ink: #0b1a15; --accent-soft: #17332c; --accent-soft-border: #234a3e;
      --warn: #e3ab56; --warn-soft: #332a17; --warn-soft-border: #4d3d20;
      --danger: #e2917c; --danger-soft: #35211c; --danger-soft-border: #4d3129;
      --focus: #4fd6b6; --overlay: rgba(0,0,0,.55);
      --shadow-sm: 0 1px 2px rgba(0,0,0,.24), 0 1px 1px rgba(0,0,0,.2);
      --shadow-md: 0 8px 24px rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.3);
    }
  }
  :root[data-theme="dark"] {
    --bg: #121613; --sidebar-bg: #0e120f; --surface: #1a201c; --surface-alt: #212722;
    --ink: #e9ece7; --ink-muted: #a2aca4; --ink-faint: #8a938c;
    --border: #303a33; --border-soft: #262f29;
    --accent: #4fd6b6; --accent-ink: #0b1a15; --accent-soft: #17332c; --accent-soft-border: #234a3e;
    --warn: #e3ab56; --warn-soft: #332a17; --warn-soft-border: #4d3d20;
    --danger: #e2917c; --danger-soft: #35211c; --danger-soft-border: #4d3129;
    --focus: #4fd6b6; --overlay: rgba(0,0,0,.55);
    --shadow-sm: 0 1px 2px rgba(0,0,0,.24), 0 1px 1px rgba(0,0,0,.2);
    --shadow-md: 0 8px 24px rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.3);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    font: 15px/1.5 var(--font-sans);
    background: var(--bg); color: var(--ink);
  }
  button { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

  /* ---------------- icons ---------------- */
  .icon { width: 14px; height: 14px; flex: none; display: inline-block; vertical-align: -2.5px; }
  .tmpl-caret, .chev { transition: transform .12s ease; }
  .tmpl-caret .icon, .chev .icon { width: 10px; height: 10px; }
  .gear-btn .icon { width: 14px; height: 14px; }
  .menu-btn .icon { width: 18px; height: 18px; vertical-align: -4px; }

  .app { display: flex; height: 100vh; }

  /* ---------------- sidebar ---------------- */
  .sidebar {
    width: 264px; flex: none; display: flex; flex-direction: column;
    background: var(--sidebar-bg); border-right: 1px solid var(--border);
  }
  .sidebar-head { padding: 14px 14px 10px; border-bottom: 1px solid var(--border-soft); }
  .workspace { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .workspace-mark {
    width: 30px; height: 30px; border-radius: 8px; flex: none;
    background: var(--accent); color: var(--accent-ink);
    display: flex; align-items: center; justify-content: center;
    font-weight: 650; font-size: 12px;
  }
  .workspace-name { font-weight: 650; font-size: 14px; }
  .workspace-sub { font-size: 11.5px; color: var(--ink-faint); }
  .self-host-badge {
    display: inline-block; font-size: 10.5px; color: var(--ink-faint);
    border: 1px solid var(--border); border-radius: 20px; padding: 2px 8px; margin-bottom: 10px;
  }
  .new-btn {
    width: 100%; padding: 7px 10px; border: 1px solid var(--border);
    border-radius: 8px; background: var(--surface); cursor: pointer; text-align: left;
  }
  .new-btn:hover { border-color: var(--accent); }
  .sidebar-body { flex: 1; overflow-y: auto; padding: 6px 8px 12px; }
  .nav-section {
    font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--ink-faint); padding: 14px 8px 6px;
  }
  .tmpl-group-head {
    display: flex; align-items: center; gap: 7px; padding: 6px 8px;
    border-radius: 7px; cursor: pointer; font-weight: 550;
  }
  .tmpl-group-head:hover { background: var(--surface-alt); }
  .tmpl-caret { width: 10px; color: var(--ink-faint); transition: transform .12s; }
  .tmpl-group.open .tmpl-caret { transform: rotate(90deg); }
  .tmpl-icon {
    width: 22px; height: 22px; border-radius: 6px; flex: none; font-size: 10px; font-weight: 650;
    background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent-soft-border);
    display: flex; align-items: center; justify-content: center;
  }
  .tmpl-name { flex: 1; font-size: 13.5px; }
  .gear-btn {
    border: 0; background: none; color: var(--ink-faint); cursor: pointer;
    padding: 2px; border-radius: 4px; opacity: 0;
  }
  .tmpl-group-head:hover .gear-btn, .gear-btn:focus-visible { opacity: 1; }
  .tmpl-runs { display: none; margin: 2px 0 4px 29px; }
  .tmpl-group.open .tmpl-runs { display: block; }
  .run-row {
    display: flex; align-items: center; gap: 7px; padding: 5px 8px;
    border-radius: 6px; cursor: pointer; font-size: 13px;
  }
  .run-row:hover { background: var(--surface-alt); }
  .run-row.active { background: var(--surface); box-shadow: inset 0 0 0 1px var(--border-soft); }
  .rr-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rr-time { font-size: 11px; color: var(--ink-faint); }
  .rr-tenant { font-size: 10.5px; color: var(--ink-faint); border: 1px solid var(--border); border-radius: 10px; padding: 0 5px; }
  .status-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--ink-faint); }
  .status-dot.ok { background: var(--accent); }
  .status-dot.warn { background: var(--warn); }
  .status-dot.danger { background: var(--danger); }
  .setup-link { display: flex; gap: 7px; align-items: center; padding: 6px 8px; border-radius: 7px; cursor: pointer; font-size: 13.5px; color: var(--ink-muted); }
  .setup-link:hover { background: var(--surface-alt); }
  .nav-link {
    display: flex; align-items: center; gap: 8px; padding: 6px 8px;
    border-radius: 7px; cursor: pointer; font-size: 13.5px; color: var(--ink);
  }
  .nav-link:hover { background: var(--surface-alt); }
  .nav-link.active { background: var(--surface); box-shadow: inset 0 0 0 1px var(--border-soft); }
  .nav-count { margin-left: auto; font-size: 11px; background: var(--warn-soft); color: var(--warn); border: 1px solid var(--warn-soft-border); border-radius: 10px; padding: 0 6px; }

  /* ---------------- main ---------------- */
  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .topbar {
    display: flex; align-items: center; gap: 10px; padding: 10px 20px;
    border-bottom: 1px solid var(--border); background: var(--surface);
    position: sticky; top: 0; z-index: 5; box-shadow: var(--shadow-sm);
  }
  .menu-btn { display: none; border: 0; background: none; cursor: pointer; padding: 2px 6px; color: var(--ink-muted); }
  .topbar-title { font-weight: 650; font-size: 15px; letter-spacing: -.005em; }
  .topbar-sub { font-size: 12px; color: var(--ink-faint); }
  .tabs { display: flex; gap: 4px; margin-left: auto; }
  .tab {
    border: 0; background: none; padding: 6px 12px; border-radius: 7px;
    font-size: 13.5px; cursor: pointer; color: var(--ink-muted); transition: background .12s ease, color .12s ease;
  }
  .tab:hover { background: var(--surface-alt); color: var(--ink); }
  .tab.active { background: var(--accent-soft); color: var(--accent); font-weight: 550; }
  .content { flex: 1; overflow-y: auto; }
  .column { max-width: 720px; margin: 0 auto; padding: 20px 16px 140px; }

  /* chain banner (ops/cross-tenant) */
  .chain-banner {
    position: sticky; top: 0; z-index: 4; font-size: 12px;
    background: var(--accent-soft); color: var(--accent);
    border: 1px solid var(--accent-soft-border); border-radius: 8px;
    padding: 6px 12px; margin-bottom: 14px;
  }
  .chain-banner.danger { background: var(--danger-soft); color: var(--danger); border-color: var(--danger-soft-border); }

  /* transcript */
  .msg-user {
    background: var(--accent); color: var(--accent-ink); border-radius: 16px;
    padding: 9px 14px; margin: 10px 0 10px auto; width: fit-content; max-width: 80%;
  }
  .msg-assistant { margin: 14px 0; }
  .msg-system { margin: 10px 0; font-size: 13px; color: var(--ink-faint); text-align: center; }
  .result-fields { margin-top: 8px; border: 1px solid var(--border-soft); border-radius: 10px; overflow: hidden; }
  .result-field { display: flex; gap: 10px; padding: 7px 12px; font-size: 13.5px; }
  .result-field + .result-field { border-top: 1px solid var(--border-soft); }
  .result-field .k { color: var(--ink-faint); min-width: 110px; }
  .result-field .v { font-weight: 550; }

  /* action chip → expandable evidence */
  .chip {
    display: inline-flex; align-items: center; gap: 7px; margin: 4px 0;
    border: 1px solid var(--border); border-radius: 20px; padding: 4px 12px 4px 8px;
    background: var(--surface); cursor: pointer; font-size: 13px;
  }
  .chip .dot { width: 8px; height: 8px; border-radius: 50%; }
  .chip .dot.ok { background: var(--accent); }
  .chip .dot.warn { background: var(--warn); }
  .chip .dot.danger { background: var(--danger); }
  .chip .dot.pending { background: var(--ink-faint); }
  .chip .chev { color: var(--ink-faint); font-size: 11px; transition: transform .12s; }
  .chip.open .chev { transform: rotate(90deg); }
  .evidence {
    border: 1px solid var(--border-soft); border-left: 3px solid var(--accent-soft-border);
    border-radius: 0 8px 8px 0; margin: 4px 0 10px 10px; padding: 10px 12px;
    font-size: 12.5px; background: var(--surface-alt); color: var(--ink-muted);
  }
  .evidence .evrow { display: flex; gap: 8px; padding: 2px 0; }
  .evidence .k { min-width: 86px; color: var(--ink-faint); }
  .evidence .same { margin-top: 8px; font-size: 11.5px; color: var(--ink-faint); border-top: 1px dashed var(--border); padding-top: 8px; }

  /* approval card — a decision point, not a chat bubble */
  .approval-card {
    border: 1.5px solid var(--warn-soft-border); border-radius: 12px;
    background: var(--warn-soft); padding: 14px 16px; margin: 14px 0;
  }
  .approval-card.resolved { border-color: var(--accent-soft-border); background: var(--accent-soft); }
  .approval-card.rejected { border-color: var(--danger-soft-border); background: var(--danger-soft); }
  .approval-q { font-weight: 600; margin-bottom: 8px; }
  .approval-detail { font-size: 13px; color: var(--ink-muted); margin-bottom: 10px; }
  .approval-input {
    width: 100%; border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; font: inherit; background: var(--surface); color: var(--ink);
    margin-bottom: 10px;
  }
  .approval-actions { display: flex; gap: 8px; }
  .btn-fill {
    border: 0; border-radius: 8px; padding: 8px 16px; cursor: pointer;
    background: var(--accent); color: var(--accent-ink); font-weight: 550;
  }
  .btn-ghost {
    border: 1px solid var(--border); border-radius: 8px; padding: 8px 16px;
    cursor: pointer; background: var(--surface);
  }
  .approval-done { font-size: 13.5px; color: var(--accent); font-weight: 550; }
  .approval-done.no { color: var(--danger); }

  /* composer */
  .composer {
    position: fixed; bottom: 0; left: 264px; right: 0;
    padding: 12px 20px 16px; background: linear-gradient(to top, var(--bg) 70%, transparent);
  }
  .composer-inner { max-width: 720px; margin: 0 auto; display: flex; gap: 8px; align-items: flex-end; }
  .composer textarea {
    flex: 1; resize: none; border: 1px solid var(--border); border-radius: 12px;
    padding: 11px 14px; font: inherit; background: var(--surface); color: var(--ink);
    min-height: 46px; max-height: 160px;
  }
  .composer .btn-fill { padding: 11px 18px; border-radius: 12px; }
  .stop-btn {
    border: 1px solid var(--danger-soft-border); color: var(--danger);
    background: var(--danger-soft); border-radius: 8px; padding: 7px 12px;
    font-size: 12.5px; cursor: pointer;
  }

  /* waiting dots — the only animation this interface needs */
  .dots { display: inline-flex; gap: 3px; padding: 6px 0; }
  .dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-faint); animation: blink 1.2s infinite; }
  .dots span:nth-child(2) { animation-delay: .2s; }
  .dots span:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: .25 } 40% { opacity: 1 } }
  @media (prefers-reduced-motion: reduce) { .dots span { animation: none; opacity: .5; } }

  /* pages (system, settings, access) */
  .page-card {
    border: 1px solid var(--border); border-radius: 12px; background: var(--surface);
    padding: 16px 18px; margin-bottom: 14px; box-shadow: var(--shadow-sm);
  }
  .page-card h3 { margin: 0 0 4px; font-size: 14.5px; }
  .page-card p { margin: 4px 0 10px; font-size: 13.5px; color: var(--ink-muted); }
  .field-label { display: block; font-size: 12.5px; color: var(--ink-muted); margin: 10px 0 4px; }
  .text-input, select {
    width: 100%; border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; font: inherit; background: var(--surface); color: var(--ink);
    transition: border-color .12s ease;
  }
  .text-input:focus, select:focus { border-color: var(--accent); }
  .text-input.mono { font-family: var(--font-mono); letter-spacing: .01em; }
  .token-once {
    font-family: var(--font-mono); font-size: 13px; word-break: break-all;
    background: var(--surface-alt); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 12px; margin: 8px 0;
  }
  .diff-old, .diff-new { font-family: var(--font-mono); font-size: 12px; border-radius: 8px; padding: 8px 10px; margin: 6px 0; }
  .diff-old { background: var(--danger-soft); }
  .diff-new { background: var(--warn-soft); }
  .empty { color: var(--ink-faint); font-size: 13.5px; padding: 24px 0; text-align: center; }

  /* wizard overlay */
  .overlay {
    position: fixed; inset: 0; background: var(--overlay); z-index: 20;
    display: flex; align-items: center; justify-content: center; padding: 20px;
  }
  .wizard {
    width: 560px; max-width: 100%; max-height: 88vh; overflow-y: auto;
    background: var(--surface); border-radius: 16px; padding: 26px 28px;
    box-shadow: var(--shadow-md), 0 20px 60px rgba(0,0,0,.18);
  }
  .wizard h2 { margin: 0 0 6px; }
  .wizard .step-sub { color: var(--ink-muted); font-size: 13.5px; margin-bottom: 18px; }
  .wizard .steps-dots { display: flex; gap: 5px; margin-bottom: 18px; }
  .wizard .steps-dots i { width: 20px; height: 4px; border-radius: 2px; background: var(--border); }
  .wizard .steps-dots i.done { background: var(--accent); }
  .choice-card {
    display: block; width: 100%; text-align: left; border: 1.5px solid var(--border);
    border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; cursor: pointer;
    background: var(--surface);
  }
  .choice-card[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
  .choice-card .cc-title { font-weight: 600; font-size: 14px; }
  .choice-card .cc-sub { font-size: 12.5px; color: var(--ink-muted); }
  .wizard-nav { display: flex; justify-content: space-between; margin-top: 18px; }
  .csv-preview { border: 1px solid var(--border); border-radius: 8px; overflow-x: auto; margin-top: 10px; }
  .csv-preview table { border-collapse: collapse; font-size: 12.5px; width: 100%; }
  .csv-preview th, .csv-preview td { border-bottom: 1px solid var(--border-soft); padding: 5px 9px; text-align: left; white-space: nowrap; }

  /* sign-in — the deployment's actual front door: no self-registration
     by design (ADR 0012/0025, admin-issued tokens), but presented like
     a real product's first screen, not a debug form. */
  .signin { max-width: 400px; margin: 12vh auto 0; padding-bottom: 40px; }
  .signin-card { padding: 30px 28px 26px; text-align: center; }
  .signin-mark {
    width: 44px; height: 44px; margin: 0 auto 16px; border-radius: 12px;
    background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent-soft-border);
    display: flex; align-items: center; justify-content: center;
  }
  .signin-mark .icon { width: 22px; height: 22px; }
  .signin-title { margin: 0 0 8px; font-size: 19px; font-weight: 650; letter-spacing: -.01em; }
  .signin-lede { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--ink-muted); }
  .signin-rule { height: 1px; background: var(--border-soft); margin: 20px 0 16px; }
  .signin-card .field-label { text-align: left; }
  .signin-card .text-input { text-align: left; }
  .signin-err { color: var(--danger); font-size: 12.5px; margin: 6px 0 0; text-align: left; }
  .signin-card .btn-icon { width: 12px; height: 12px; }
  .signin-help {
    margin-top: 16px; padding: 14px 16px; border: 1px solid var(--border-soft);
    border-radius: 12px; background: var(--surface-alt);
  }
  .signin-help p { margin: 0 0 10px; font-size: 12.5px; line-height: 1.6; color: var(--ink-muted); }
  .signin-help p:last-child { margin-bottom: 0; }
  .signin-help strong { color: var(--ink); font-weight: 600; }
  .signin-help code {
    font-family: var(--font-mono); font-size: 11.5px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px;
  }

  @media (max-width: 780px) {
    .sidebar { position: fixed; z-index: 15; height: 100%; transform: translateX(-100%); transition: transform .2s; }
    .sidebar.open { transform: translateX(0); }
    .menu-btn { display: block; }
    .composer { left: 0; }
    .backdrop { position: fixed; inset: 0; background: var(--overlay); z-index: 14; }
  }
  .backdrop { display: none; }
  .backdrop.show { display: block; }
</style>
</head>
<body>
<div class="app">
  <div class="backdrop" id="backdrop"></div>
  <aside class="sidebar" id="sidebar"></aside>
  <main class="main">
    <header class="topbar" id="topbar"></header>
    <div class="content" id="content"></div>
  </main>
</div>
<div id="overlays"></div>
<div class="composer" id="composer" style="display:none"></div>
<script>window.NARO_CHAT_CONFIG = __NARO_CHAT_CONFIG__;</script>
<script type="module" src="/chat-ui/app.js"></script>
</body>
</html>`;
