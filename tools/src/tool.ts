import type { ExecContext, TrustLevel } from '@naro/core';
import type { JsonSchema } from './schema.ts';

/**
 * What a tool can do to the world — declared so policy can reason about
 * it before execution, not after damage is done.
 */
export type SideEffect = 'none' | 'read' | 'write' | 'destructive';

/**
 * A Tool is a capability the agent can invoke.
 *
 * Everything about a tool is declarative metadata *except* `execute`:
 * the schema tells the model how to call it, `permissions` tells policy
 * what it needs, `sideEffects` tells governance what it can break.
 * A registry full of honest tool metadata is what makes tool selection
 * and authorization possible at all.
 */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema?: JsonSchema;
  /** Permissions the agent must hold to use this tool. */
  readonly permissions: readonly string[];
  readonly sideEffects: SideEffect;
  /**
   * True when repeating this tool with the same input is safe —
   * retry policies and resumption may auto-retry only when this is set.
   * Default: treated as non-idempotent (never blindly retried).
   */
  readonly idempotent?: boolean;
  /** Trust of this tool's output. Default 'tool'; set 'external' for
   *  anything that returns content authored outside the system — web
   *  pages, emails, files from untrusted repos. */
  readonly trust?: TrustLevel;
  /**
   * Integrity pin over `{name, description, inputSchema}` — computed by
   * remote ToolSources (ADR 0016). The registry compares it across
   * refreshes: a changed hash is a possible rug pull and the tool is
   * forced to `sideEffects: 'destructive'` until an operator acknowledges.
   * Local, hand-authored tools don't need one.
   */
  readonly definitionHash?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  execute(input: unknown, ctx: ExecContext): Promise<unknown>;
}
