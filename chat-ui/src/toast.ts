import { h } from './dom.ts';

/**
 * Toasts — bottom-corner confirmation for actions whose result isn't
 * already visible in place. The rule: an action the user just took in
 * the element they're looking at gets inline feedback; an action that
 * changed state off-viewport (a palette command, a list refresh) gets a
 * toast. Auto-dismisses; respects prefers-reduced-motion via CSS.
 */
export type ToastKind = 'ok' | 'warn' | 'danger';

export function toast(text: string, kind: ToastKind = 'ok', ms = 4200): void {
  const host = document.getElementById('toasts');
  if (host === null) return;
  const el = h('div', { class: `toast ${kind}`, role: 'status' },
    h('span', { class: 'dot' }), h('span', {}, text));
  host.append(el);
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 280);
  };
  setTimeout(dismiss, ms);
  el.addEventListener('click', dismiss);
}
