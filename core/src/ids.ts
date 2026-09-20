import { randomUUID } from 'node:crypto';

/**
 * Generates a brand-prefixed unique identifier, e.g. `goal_3f8a2b…`.
 * Prefixes make ids self-describing in logs, events, and audit trails.
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
