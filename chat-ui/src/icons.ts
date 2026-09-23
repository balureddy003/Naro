/**
 * One small, consistent icon set — stroke-width 1.6 throughout, matching
 * docs/product/prd-006-mockup.html's icon language. Built via `innerHTML`
 * on a static, hardcoded path string (never user input) rather than
 * `createElementNS` per node — the whole point of this file is to keep
 * icon markup in one place instead of unicode glyphs (▸, ⚙, ☰) scattered
 * through app.ts/chat.ts, which is what made the shipped UI read as
 * "default browser chrome" instead of a considered product.
 */

const PATHS: Record<string, string> = {
  caret: '<path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  gear: '<circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.4 3.6l-1.4 1.4M5 9.6l-1.4 1.4M12.4 12.4l-1.4-1.4M5 6.4L3.6 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>',
  menu: '<path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>',
  shield: '<path d="M8 1.5L2.5 3.8v3.5C2.5 11 4.9 13.4 8 14.2c3.1-.8 5.5-3.2 5.5-6.9V3.8L8 1.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/><path d="M5.5 8l1.8 1.8L10.8 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  key: '<circle cx="5.5" cy="10.5" r="3" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M7.6 8.4L13.5 2.5M11 5l1.8 1.8M9 7l1.3 1.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  arrow: '<path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
};

export type IconName = keyof typeof PATHS;

/** An inline `<svg>` icon, 16x16 viewBox, sized by CSS (`.icon` class). */
export function icon(name: IconName, cls = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', cls === '' ? 'icon' : `icon ${cls}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[name]!;
  return svg;
}
