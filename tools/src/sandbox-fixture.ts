import { createObservation, type Action, type ActionExecutor, type ExecContext, type Observation } from '@naro/core';

/** Test fixture loaded inside the sandbox worker — not for production use. */
export function createExecutor(): ActionExecutor {
  return {
    async execute(action: Action, _ctx: ExecContext): Promise<Observation> {
      if (action.target === 'tool://hang') {
        await new Promise(() => {}); // never resolves — timeout/abort test
      }
      if (action.target === 'tool://boom') {
        throw new Error('tool exploded');
      }
      return createObservation({
        actionId: action.id, source: action.target,
        kind: 'tool-result', success: true,
        output: { echo: action.input },
      });
    },
  };
}
