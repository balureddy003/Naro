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
  .sidebar-head { padding: 16px 16px 12px; border-bottom: 1px solid var(--border-soft); }
  .workspace { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .workspace.clickable { cursor: pointer; border-radius: 8px; padding: 4px; margin: -4px -4px 6px; transition: background .12s ease; }
  .workspace.clickable:hover { background: var(--surface-alt); }
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
    display: flex; align-items: center; gap: 7px; padding: 6px 8px;
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
    background: var(--warn-soft); padding: 16px; margin: 16px 0;
  }
  .approval-card.resolved { border-color: var(--accent-soft-border); background: var(--accent-soft); }
  .approval-card.rejected { border-color: var(--danger-soft-border); background: var(--danger-soft); }
  .approval-q { font-weight: 600; margin-bottom: 8px; }
  .approval-detail { font-size: 13px; color: var(--ink-muted); margin-bottom: 10px; }
  .approval-input {
    width: 100%; border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; font: inherit; background: var(--surface); color: var(--ink);
    margin-bottom: 12px;
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
  .btn-danger { background: var(--danger); }
  .form-action { margin-top: 12px; }
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
    padding: 12px 14px; font: inherit; background: var(--surface); color: var(--ink);
    min-height: 48px; max-height: 160px;
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

  /* skeletons — content-shaped placeholders while a view's real data is
     still on the wire. One shimmer rule, several block sizes; the block
     heights match what real content lands as, so the swap doesn't jump. */
  .sk {
    position: relative; overflow: hidden; border-radius: 8px;
    background: var(--surface-alt); border: 1px solid var(--border-soft);
  }
  .sk::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent);
    transform: translateX(-100%); animation: shimmer 1.4s infinite;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) .sk::after {
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.05), transparent);
    }
  }
  :root[data-theme="dark"] .sk::after {
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.05), transparent);
  }
  @keyframes shimmer { to { transform: translateX(100%); } }
  @media (prefers-reduced-motion: reduce) { .sk::after { animation: none; } }
  .sk-row { height: 30px; margin: 6px 0; }
  .sk-card { height: 92px; margin-bottom: 14px; }
  .sk-chip { height: 28px; width: 180px; border-radius: 20px; margin: 4px 0; }
  .sk-msg { height: 44px; width: 55%; border-radius: 16px; margin: 10px 0 10px auto; }

  /* toasts — bottom-corner confirmation for actions taken away from
     their context (palette commands, background polls). In-place actions
     keep their inline confirmation instead of double-reporting. */
  .toasts {
    position: fixed; bottom: 20px; right: 20px; z-index: 40;
    display: flex; flex-direction: column; gap: 8px; max-width: 340px;
  }
  .toast {
    display: flex; align-items: center; gap: 9px; padding: 10px 14px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; box-shadow: var(--shadow-md);
    font-size: 13px; animation: toast-in .18s ease;
  }
  .toast .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .toast.ok .dot { background: var(--accent); }
  .toast.warn .dot { background: var(--warn); }
  .toast.danger .dot { background: var(--danger); }
  .toast.out { opacity: 0; transform: translateY(6px); transition: opacity .25s, transform .25s; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } }
  @media (prefers-reduced-motion: reduce) {
    .toast { animation: none; }
    .toast.out { transition: none; }
  }

  /* command palette — Linear's pattern scoped to what this app actually
     has: navigation + the few real commands, not a universal search. */
  .palette { position: fixed; inset: 0; z-index: 30; display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; background: var(--overlay); }
  .palette-box {
    width: 560px; max-width: calc(100vw - 32px); max-height: 60vh; overflow: hidden;
    display: flex; flex-direction: column;
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
    box-shadow: var(--shadow-md), 0 24px 64px rgba(0,0,0,.22);
    animation: palette-in .12s ease;
  }
  @keyframes palette-in { from { opacity: 0; transform: translateY(-6px) scale(.99); } }
  @media (prefers-reduced-motion: reduce) { .palette-box { animation: none; } }
  .palette-input {
    border: 0; border-bottom: 1px solid var(--border-soft); padding: 14px 16px;
    font: inherit; font-size: 14.5px; background: none; color: var(--ink); outline: none;
  }
  .palette-list { overflow-y: auto; padding: 6px; }
  .palette-item {
    display: flex; align-items: center; gap: 10px; padding: 8px 10px;
    border-radius: 8px; cursor: pointer; font-size: 13.5px;
  }
  .palette-item .icon { color: var(--ink-faint); }
  .palette-item.sel { background: var(--accent-soft); }
  .palette-item .pi-hint { margin-left: auto; font-size: 11.5px; color: var(--ink-faint); }
  .palette-empty { padding: 18px; font-size: 13px; color: var(--ink-faint); text-align: center; }
  .kbd {
    font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-faint);
    border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px;
  }

  /* first-run checklist — one dismissible card on the empty Runs state,
     only while there's genuinely nothing done yet (zero runs, admin). */
  .firstrun {
    border: 1px solid var(--accent-soft-border); background: var(--accent-soft);
    border-radius: 12px; padding: 16px 20px; margin-bottom: 14px;
  }
  .firstrun h3 { margin: 0 0 2px; font-size: 14.5px; }
  .firstrun .fr-sub { font-size: 12.5px; color: var(--ink-muted); margin: 0 0 12px; }
  .firstrun-item {
    display: flex; align-items: center; gap: 9px; padding: 5px 0;
    font-size: 13.5px; color: var(--ink); cursor: pointer; border-radius: 6px;
    background: none; border: 0; text-align: left; width: 100%;
  }
  .firstrun-item:hover .fr-link { text-decoration: underline; }
  .firstrun-item.done { color: var(--ink-muted); }
  .firstrun-item .box {
    width: 15px; height: 15px; border-radius: 4px; flex: none;
    border: 1.5px solid var(--accent); display: flex; align-items: center; justify-content: center;
    font-size: 10px; color: var(--accent-ink);
  }
  .firstrun-item.done .box { background: var(--accent); }
  .firstrun-dismiss {
    border: 0; background: none; color: var(--ink-faint); cursor: pointer;
    float: right; font-size: 12px; padding: 2px 4px;
  }

  /* optimistic states — the DOM commits before the server answers. */
  .msg-user.pending { opacity: .65; }
  .msg-user.failed { background: var(--danger); }
  .approval-card.confirming { opacity: .7; }
  .chip-enter { animation: chip-in .16s ease; }
  @keyframes chip-in { from { opacity: 0; transform: translateY(4px); } }
  @media (prefers-reduced-motion: reduce) { .chip-enter { animation: none; } }

  /* pages (system, settings, access) */
  .page-card {
    border: 1px solid var(--border); border-radius: 12px; background: var(--surface);
    padding: 16px 20px; margin-bottom: 14px; box-shadow: var(--shadow-sm);
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
    background: var(--surface); border-radius: 16px; padding: 24px 28px;
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
     a real product's first screen, not a debug form. On the auth screen
     the app chrome (sidebar/topbar/composer) hides entirely — the card
     centers in the real viewport, not inside the leftover app frame. */
  .app.auth .sidebar, .app.auth .topbar, .app.auth .composer { display: none; }
  .app.auth .content {
    display: flex; position: relative; overflow: hidden;
  }
  /* layered backdrop: one broad accent wash top-center + a faint second
     light lower-right — depth without a photo or gradient mesh */
  .app.auth .content::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background:
      radial-gradient(900px 420px at 30% 24%, var(--accent-soft), transparent 70%),
      radial-gradient(700px 380px at 78% 82%, var(--accent-soft), transparent 65%);
    opacity: .55;
  }
  .signin {
    max-width: 940px; width: 100%; margin: auto; padding: 48px 24px;
    align-self: center; position: relative;
    animation: signin-in .45s cubic-bezier(.16,1,.3,1);
  }
  @keyframes signin-in { from { opacity: 0; transform: translateY(14px) scale(.985); } }
  /* staggered entrance — the hero's story lands in sequence, then the
     panel; one shared animation, stepped delays */
  .hero-mark, .hero-title, .hero-lede, .hero-point, .signin-panel > * {
    animation: rise .5s cubic-bezier(.16,1,.3,1) both;
  }
  .hero-title { animation-delay: .06s }
  .hero-lede { animation-delay: .12s }
  .hero-point:nth-child(1) { animation-delay: .18s }
  .hero-point:nth-child(2) { animation-delay: .24s }
  .hero-point:nth-child(3) { animation-delay: .30s }
  .hero-chain { animation: rise .5s cubic-bezier(.16,1,.3,1) .36s both; }
  .signin-panel > *:nth-child(-n+3) { animation-delay: .10s }
  .signin-panel > *:nth-child(n+4):nth-child(-n+6) { animation-delay: .16s }
  .signin-panel > *:nth-child(n+7) { animation-delay: .22s }
  .signin-help, .signin-foot { animation: rise .5s cubic-bezier(.16,1,.3,1) .34s both; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
  @media (prefers-reduced-motion: reduce) {
    .signin, .hero-mark, .hero-title, .hero-lede, .hero-point, .hero-chain,
    .signin-panel > *, .signin-help, .signin-foot { animation: none; }
  }
  /* the hash-chain motif — three linked nodes, one verified check.
     A true picture of what the product does, drawn faint enough to be
     texture, not illustration. */
  .hero-chain { margin-top: 40px; opacity: .55; }
  .hero-chain circle { fill: var(--surface); stroke: var(--accent); stroke-width: 1.4; }
  .hero-chain line { stroke: var(--accent); stroke-width: 1.2; opacity: .5; }
  .hero-chain path { stroke: var(--accent); stroke-width: 1.6; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .signin-split {
    display: flex; border-radius: 20px; overflow: hidden;
    border: 1px solid var(--border); background: var(--surface);
    box-shadow: var(--shadow-md), 0 30px 80px rgba(0,0,0,.14);
  }
  /* hero — the one true story, told once */
  .signin-hero {
    flex: 1.15; min-width: 0; padding: 52px 48px;
    display: flex; flex-direction: column; justify-content: center;
    background: linear-gradient(160deg, var(--accent-soft), var(--surface-alt) 85%);
    border-right: 1px solid var(--border-soft);
  }
  .hero-mark {
    width: 56px; height: 56px; border-radius: 16px;
    background: var(--accent); color: var(--accent-ink);
    display: flex; align-items: center; justify-content: center;
    box-shadow: var(--shadow-sm); margin-bottom: 24px;
  }
  .hero-mark .icon { width: 28px; height: 28px; }
  .hero-title { font-size: 26px; font-weight: 650; letter-spacing: -.02em; margin: 0 0 10px; }
  .hero-lede { font-size: 14px; line-height: 1.65; color: var(--ink-muted); margin: 0 0 32px; max-width: 340px; }
  .hero-points { display: flex; flex-direction: column; gap: 14px; }
  .hero-point {
    display: flex; align-items: flex-start; gap: 12px;
    font-size: 13.5px; line-height: 1.5; color: var(--ink);
  }
  .hero-point .icon { width: 17px; height: 17px; color: var(--accent); margin-top: 1px; flex: none; }
  .hero-point span { color: var(--ink-muted); }
  .hero-point strong { display: block; font-weight: 600; color: var(--ink); }
  /* form panel */
  .signin-panel {
    flex: 1; min-width: 360px; padding: 52px 48px;
    display: flex; flex-direction: column; justify-content: center;
  }
  .signin-title { margin: 0 0 6px; font-size: 21px; font-weight: 650; letter-spacing: -.015em; }
  .signin-sub { margin: 0 0 24px; font-size: 13px; color: var(--ink-muted); }
  .auth-tabs {
    display: flex; gap: 3px; margin: 0 0 24px; padding: 3px;
    background: var(--surface-alt); border: 1px solid var(--border-soft); border-radius: 10px;
    position: relative;
  }
  /* sliding pill — the selection moves, the labels stay put */
  .tab-pill {
    position: absolute; top: 3px; bottom: 3px; left: 3px;
    width: calc(50% - 4.5px); border-radius: 8px;
    background: var(--surface); box-shadow: var(--shadow-sm);
    transition: left .2s cubic-bezier(.16,1,.3,1);
  }
  .auth-tabs.login .tab-pill { left: calc(50% + 1.5px); }
  @media (prefers-reduced-motion: reduce) { .tab-pill { transition: none; } }
  .auth-tab {
    flex: 1; border: 0; background: none; padding: 8px 0; border-radius: 8px;
    font: inherit; font-size: 13px; font-weight: 550; color: var(--ink-muted); cursor: pointer;
    position: relative; z-index: 1; transition: color .15s ease;
  }
  .auth-tab.active { color: var(--ink); }
  .field-label { font-weight: 550; }
  .pw-wrap { position: relative; }
  .pw-wrap .text-input { padding-right: 40px; }
  .pw-toggle {
    position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
    border: 0; background: none; color: var(--ink-faint); cursor: pointer; padding: 4px;
    display: flex; align-items: center;
  }
  .pw-toggle:hover { color: var(--ink-muted); }
  .pw-toggle .icon { width: 16px; height: 16px; }
  .signin .text-input { padding: 11px 13px; font-size: 14px; transition: border-color .12s ease, box-shadow .12s ease; }
  .signin .text-input:focus {
    border-color: var(--accent); outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  /* Chrome's autofill paints its own colors — reclaim them for the theme */
  .signin .text-input:-webkit-autofill {
    -webkit-text-fill-color: var(--ink);
    -webkit-box-shadow: 0 0 0 40px var(--surface) inset;
    caret-color: var(--ink);
    border-color: var(--accent-soft-border);
    transition: background-color 99999s ease-out;
  }
  /* field-level failure — the offending field carries the error, not
     just the message below the form */
  .text-input.invalid { border-color: var(--danger); }
  .text-input.invalid:focus { box-shadow: 0 0 0 3px var(--danger-soft); }
  .shake { animation: shake .32s ease; }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    55% { transform: translateX(4px); }
    80% { transform: translateX(-2px); }
  }
  @media (prefers-reduced-motion: reduce) { .shake { animation: none; } }
  /* password strength — three honest segments (length is the only rule
     this deployment enforces, so the meter measures exactly that) */
  .pw-meter { display: flex; gap: 4px; margin-top: 8px; }
  .pw-meter i {
    height: 3px; flex: 1; border-radius: 2px; background: var(--border);
    transition: background .15s ease;
  }
  .pw-meter.s1 i:nth-child(1) { background: var(--danger); }
  .pw-meter.s2 i:nth-child(-n+2) { background: var(--warn); }
  .pw-meter.s3 i { background: var(--accent); }
  .signin-btn {
    width: 100%; margin-top: 16px; padding: 12px 16px; min-height: 46px;
    display: flex; align-items: center; justify-content: center; gap: 9px;
    font-size: 14px; transition: filter .12s ease, transform .06s ease, box-shadow .12s ease;
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 88%, white), var(--accent));
    box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,.14);
  }
  .signin-btn:hover:not([disabled]) { filter: brightness(1.07); box-shadow: var(--shadow-md), inset 0 1px 0 rgba(255,255,255,.14); }
  .signin-btn:active:not([disabled]) { transform: translateY(1px); }
  .signin-btn[disabled] { opacity: .75; cursor: default; }
  .btn-icon { width: 13px; height: 13px; }
  .spinner {
    width: 15px; height: 15px; border-radius: 50%; flex: none;
    border: 2px solid currentColor; border-top-color: transparent;
    animation: spin .7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 1.8s; } }
  .err-slot:empty { display: none; }
  .signin-err {
    display: flex; align-items: center; gap: 8px;
    color: var(--danger); font-size: 12.5px; margin: 10px 0 0; text-align: left;
    animation: err-in .18s ease;
  }
  @keyframes err-in { from { opacity: 0; transform: translateY(-3px); } }
  @media (prefers-reduced-motion: reduce) { .signin-err { animation: none; } }
  .signin-err .icon { width: 13px; height: 13px; flex: none; }
  .field-hint { margin: 6px 0 0; font-size: 11.5px; color: var(--ink-faint); }
  .signin-help {
    margin-top: 20px; padding: 14px 16px; border: 1px solid var(--border-soft);
    border-radius: 12px; background: var(--surface-alt); max-width: 460px; margin-left: auto; margin-right: auto;
  }
  .signin-help p { margin: 0 0 10px; font-size: 12.5px; line-height: 1.6; color: var(--ink-muted); }
  .signin-help p:last-child { margin-bottom: 0; }
  .signin-help strong { color: var(--ink); font-weight: 600; }
  .signin-help code {
    font-family: var(--font-mono); font-size: 11.5px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px;
  }
  .signin-foot {
    margin-top: 28px; text-align: center; font-size: 11px; color: var(--ink-faint);
    letter-spacing: .02em;
  }
  .signin-foot .icon { width: 11px; height: 11px; vertical-align: -1.5px; margin-right: 4px; }
  @media (max-width: 760px) {
    .signin-split { flex-direction: column; }
    .signin-hero { padding: 36px 32px; border-right: 0; border-bottom: 1px solid var(--border-soft); }
    .hero-points { display: none; }
    .signin-panel { min-width: 0; padding: 36px 32px; }
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

  /* account menu — identity + sign out, anchored to the workspace row */
  .account-menu {
    position: fixed; z-index: 45; min-width: 210px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; box-shadow: var(--shadow-md); padding: 12px 8px 6px;
    animation: palette-in .12s ease;
  }
  .am-id { font-size: 13px; font-weight: 600; padding: 0 8px; word-break: break-all; }
  .am-roles { font-size: 11.5px; color: var(--ink-faint); padding: 2px 8px 8px; }
  .am-rule { height: 1px; background: var(--border-soft); margin: 4px 0; }
  .am-item {
    display: flex; align-items: center; gap: 9px; width: 100%;
    border: 0; background: none; padding: 8px; border-radius: 7px;
    font: inherit; font-size: 13px; cursor: pointer; text-align: left; color: var(--ink);
  }
  .am-item:hover { background: var(--surface-alt); }
  .am-item.danger { color: var(--danger); }
  .am-item .icon { width: 14px; height: 14px; }
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
<div class="toasts" id="toasts" aria-live="polite"></div>
<div class="composer" id="composer" style="display:none"></div>
<script>window.NARO_CHAT_CONFIG = __NARO_CHAT_CONFIG__;</script>
<script type="module" src="/chat-ui/app.js"></script>
</body>
</html>`;
