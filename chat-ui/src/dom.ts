/**
 * Minimal DOM helpers — this package ships no framework (same constraint
 * as the ops console: static ESM, no bundler, no CDN). `h()` is the whole
 * templating story.
 */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('aria-') || k === 'role' || k === 'type' || k === 'href' || k === 'src' || k === 'for' || k === 'placeholder' || k === 'value' || k === 'disabled' || k === 'title' || k === 'id') {
      if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    el.append(c as Node | string);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Relative time for run rows — "2m", "1h", "yesterday". */
export function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return d === 1 ? 'yesterday' : `${d}d`;
}

export function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function shortHash(hash: string | undefined): string {
  return hash === undefined ? '—' : `${hash.slice(0, 12)}…`;
}
