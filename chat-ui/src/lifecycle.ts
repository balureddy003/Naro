/**
 * View subscriptions (watchRun/pollApprovals streams) outlive the DOM
 * they paint into — a run's SSE tail shouldn't survive navigating away.
 * Views push their unsubscribe handles here; the router drains them on
 * every render.
 */
export const disposers: (() => void)[] = [];

export function disposeAll(): void {
  while (disposers.length > 0) disposers.pop()!();
}
