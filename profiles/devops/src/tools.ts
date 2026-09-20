import { createAction, type ExecContext } from '@naro/core';
import type { Tool } from '@naro/tools';
import type { DevOpsEnvironment } from './devops-env.ts';

/** Model-facing tools over the DevOps environment. */
export function devopsTools(env: DevOpsEnvironment): Tool[] {
  const call = async (cap: string, input: unknown, ctx: ExecContext): Promise<unknown> => {
    const obs = await env.execute(
      createAction(ctx.agentId, { capability: cap, target: `env://${env.id}/${cap}`, input }), ctx);
    if (!obs.success) throw new Error(obs.error ?? `${cap} failed`);
    return obs.output;
  };
  return [
    {
      name: 'runbook_list',
      description: 'List declared operational tasks (name, description, params, side effects).',
      inputSchema: { type: 'object', properties: {} },
      permissions: ['runbook.list'],
      sideEffects: 'read',
      execute: (_i, ctx) => call('runbook.list', {}, ctx),
    },
    {
      name: 'runbook_run',
      description: 'Run a declared runbook task by name with validated params. Only declared tasks exist — no arbitrary commands.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          params: { type: 'object', description: 'param name → value; each validated against its declared pattern' },
        },
        required: ['name'],
      } as const,
      permissions: ['runbook.run'],
      sideEffects: 'write',
      execute: (i, ctx) => call('runbook.run', i, ctx),
    },
    {
      name: 'http_probe',
      description: 'GET an allowlisted URL, return {status, ok, latencyMs} — health checks.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' }, timeoutMs: { type: 'number' } },
        required: ['url'],
      } as const,
      permissions: ['probe.http'],
      sideEffects: 'read',
      execute: (i, ctx) => call('probe.http', i, ctx),
    },
  ];
}
