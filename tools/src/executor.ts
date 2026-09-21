import {
  createObservation,
  type Action,
  type ActionExecutor,
  type ExecContext,
  type Observation,
} from '@naro/core';
import { validate } from './schema.ts';
import type { ToolRegistry } from './registry.ts';

const TOOL_SCHEME = 'tool://';

/**
 * Runs the tool lifecycle:
 *   resolve → validate-in → execute → validate-out → observe.
 *
 * Authorization happens upstream — the runner's PolicyEngine gates every
 * action before it reaches an executor (see createToolPolicy). This
 * executor is *also* the record of what ran: every call, success or
 * failure, ends as an Observation.
 *
 * Errors never throw across this boundary — a broken tool produces a
 * failed observation, which is evidence the reasoner can act on.
 */
export class ToolExecutor implements ActionExecutor {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async execute(action: Action, ctx: ExecContext): Promise<Observation> {
    const name = action.target.startsWith(TOOL_SCHEME)
      ? action.target.slice(TOOL_SCHEME.length)
      : action.target;

    const tool = this.registry.get(name);
    if (!tool) {
      return this.fail(action, `unknown tool '${name}'`);
    }

    const inputErrors = validate(tool.inputSchema, action.input);
    if (inputErrors.length > 0) {
      return this.fail(
        action,
        `invalid input: ${inputErrors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
      );
    }

    let output: unknown;
    try {
      output = await tool.execute(action.input, ctx);
    } catch (error) {
      return this.fail(action, error instanceof Error ? error.message : String(error));
    }

    if (tool.outputSchema) {
      const outputErrors = validate(tool.outputSchema, output);
      if (outputErrors.length > 0) {
        return this.fail(
          action,
          `tool '${name}' breached its output contract: ` +
            outputErrors.map((e) => `${e.path} ${e.message}`).join('; '),
        );
      }
    }

    return createObservation({
      actionId: action.id,
      source: action.target,
      kind: 'tool-result',
      success: true,
      trust: tool.trust ?? 'tool',
      output,
    });
  }

  private fail(action: Action, error: string): Observation {
    return createObservation({
      actionId: action.id,
      source: action.target,
      kind: 'tool-result',
      success: false,
      error,
    });
  }
}
