import {
  createObservation,
  type Action,
  type ActionExecutor,
  type ExecContext,
  type Observation,
} from '@naro/core';

/**
 * Routes actions to the executor that owns their target's URI scheme:
 *   tool://calculator → ToolExecutor,  env://local → Environment.
 *
 * This is how the runtime stays domain-blind: it only ever sees
 * `ActionExecutor`, and new schemes plug in by adding a route.
 */
export class CompositeExecutor implements ActionExecutor {
  private readonly routes: Readonly<Record<string, ActionExecutor>>;

  /** `routes` maps URI-scheme prefix → executor, e.g. `{ 'tool://': tools, 'env://': env }`. */
  constructor(routes: Readonly<Record<string, ActionExecutor>>) {
    this.routes = routes;
  }

  async execute(action: Action, ctx: ExecContext): Promise<Observation> {
    for (const [prefix, executor] of Object.entries(this.routes)) {
      if (action.target.startsWith(prefix)) {
        return executor.execute(action, ctx);
      }
    }
    return createObservation({
      actionId: action.id,
      source: 'runtime',
      kind: 'error',
      success: false,
      error: `No executor registered for target '${action.target}'`,
    });
  }
}
