/**
 * Jargon-free copy — PRD-006's rule is "no jargon, anywhere" in default
 * surfaces ("Read invoice_2847.pdf", not "action.completed"). The
 * expanded evidence view is the one place technical terms are allowed,
 * because a user who opened it asked for the detail.
 */

/** capability → the verb phrase on an action chip. */
export function actionLabel(capability: string, target: string): string {
  const map: Record<string, string> = {
    get_document: `Read ${target}`,
    compute_total: 'Checked the math',
    lookup_history: `Looked up past ${target}`,
    list_categories: 'Listed the allowed categories',
  };
  if (map[capability]) return map[capability]!;
  // tool:read_invoice → "Read invoice"; unknown capabilities still get a
  // human sentence — never the raw capability string.
  const pretty = capability.replace(/^tool:/, '').replace(/_/g, ' ');
  return `${pretty[0]!.toUpperCase()}${pretty.slice(1)}${target ? ` — ${target}` : ''}`;
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
