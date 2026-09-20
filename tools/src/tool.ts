import type { ExecContext } from '@naro/core';
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
  readonly metadata?: Readonly<Record<string, unknown>>;
  execute(input: unknown, ctx: ExecContext): Promise<unknown>;
}
