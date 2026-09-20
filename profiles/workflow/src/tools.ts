import { createAction, type ExecContext } from '@naro/core';
import type { Tool } from '@naro/tools';
import type { WorkflowEnvironment } from './workflow-env.ts';

/** Model-facing tools over the workflow environment. */
export function workflowTools(env: WorkflowEnvironment): Tool[] {
  const call = async (cap: string, input: unknown, ctx: ExecContext): Promise<unknown> => {
    const obs = await env.execute(
      createAction(ctx.agentId, { capability: cap, target: `env://${env.id}/${cap}`, input }), ctx);
    if (!obs.success) throw new Error(obs.error ?? `${cap} failed`);
    return obs.output;
  };
  const spec = {
    type: 'object',
    properties: {
      spec: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                capability: { type: 'string' },
                target: { type: 'string', description: 'executor-facing target; defaults to workflow://<env>/<step>' },
                input: { description: 'may contain "$stepId" or "$stepId.field" refs to prior outputs' },
                dependsOn: { type: 'array', items: { type: 'string' } },
                retries: { type: 'number' },
              },
              required: ['id', 'capability'],
            },
          },
        },
        required: ['steps'],
      },
    },
    required: ['spec'],
  } as const;
  return [
    {
      name: 'workflow_validate',
      description: 'Statically check a workflow spec — cycles, unknown deps — without running it.',
      inputSchema: spec,
      permissions: ['workflow.validate'],
      sideEffects: 'read',
      execute: (i, ctx) => call('workflow.validate', i, ctx),
    },
    {
      name: 'workflow_run',
      description: 'Execute a step DAG in dependency order with per-step retries. Returns {outputs, completed, failed?}.',
      inputSchema: spec,
      permissions: ['workflow.run'],
      sideEffects: 'write',
      execute: (i, ctx) => call('workflow.run', i, ctx),
    },
  ];
}
