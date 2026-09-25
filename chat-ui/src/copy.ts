/**
 * Jargon-free copy — PRD-006's rule is "no jargon, anywhere" in default
 * surfaces ("Read invoice_2847.pdf", not "action.completed"). The
 * expanded evidence view is the one place technical terms are allowed,
 * because a user who opened it asked for the detail.
 */

/** capability → the verb phrase on an action chip. */
export function actionLabel(capability: string, target: string): string {
  // Tools arrive as capability 'tool.invoke' + target 'tool://name' —
  // label by the tool's name, not the mechanism that invoked it.
  const tool = target.replace(/^tool:\/\//, '');
  const map: Record<string, string> = {
    get_document: `Read ${tool}`,
    compute_total: 'Checked the math',
    lookup_history: 'Looked up past transactions',
    list_categories: 'Listed the allowed categories',
    recall_category: 'Checked remembered vendors',
    remember: 'Remembered this vendor',
    delegate: `Delegated to ${tool === 'delegate' ? 'a child agent' : tool}`,
    search_vendors: 'Researched the vendor',
  };
  if (map[tool]) return map[tool]!;
  if (map[capability]) return map[capability]!;
  const pretty = (capability === 'tool.invoke' ? tool : capability.replace(/^tool:/, '')).replace(/_/g, ' ');
  return `${pretty[0]!.toUpperCase()}${pretty.slice(1)}`;
}

export function policyBadge(policy: 'permitted' | 'approved' | 'denied' | 'unresolved', verification?: { ok: boolean }): { cls: string; text: string } {
  if (policy === 'denied') return { cls: 'danger', text: 'Blocked by policy' };
  if (verification && !verification.ok) return { cls: 'warn', text: 'Needs review' };
  if (policy === 'approved') return { cls: 'ok', text: 'Approved' };
  return { cls: 'ok', text: 'Verified' };
}

export function runStatusLabel(status: string): { cls: string; text: string } {
  switch (status) {
    case 'running': return { cls: 'warn', text: 'Working…' };
    case 'completed': return { cls: 'ok', text: 'Done' };
    case 'failed': return { cls: 'danger', text: 'Stopped with an error' };
    case 'cancelled': return { cls: 'warn', text: 'Stopped by a person' };
    case 'paused': return { cls: 'warn', text: 'Waiting on you' };
    default: return { cls: 'warn', text: status };
  }
}

/** `NaroApiError.message` is the raw response body — usually
 *  `{"error":"…"}` — so unwrap it to the sentence rather than showing
 *  JSON to a person. Non-JSON bodies pass through unchanged. */
export function errText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch { /* not JSON — raw text is the message */ }
  return raw;
}
