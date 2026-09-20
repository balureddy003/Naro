import { createAction, type ExecContext } from '@naro/core';
import type { Tool } from '@naro/tools';
import type { ResearchEnvironment } from './research-env.ts';

/** Model-facing tools over the research environment. */
export function researchTools(env: ResearchEnvironment): Tool[] {
  const call = async (cap: string, input: unknown, ctx: ExecContext): Promise<unknown> => {
    const obs = await env.execute(
      createAction(ctx.agentId, { capability: cap, target: `env://${env.id}/${cap}`, input }), ctx);
    if (!obs.success) throw new Error(obs.error ?? `${cap} failed`);
    return obs.output;
  };
  return [
    {
      name: 'web_fetch',
      description: 'Fetch a page from an allowlisted domain. Returns {url, status, content}.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
      permissions: ['net.fetch'],
      sideEffects: 'read',
      execute: (input, ctx) => call('net.fetch', { url: (input as { url: string }).url }, ctx),
    },
    {
      name: 'add_citation',
      description: 'Record that a claim is supported by a fetched URL. Fails for unfetched URLs.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' }, claim: { type: 'string' } },
        required: ['url', 'claim'],
      },
      permissions: ['cite.add'],
      sideEffects: 'write',
      execute: (input, ctx) => call('cite.add', input, ctx),
    },
    {
      name: 'list_citations',
      description: 'List all recorded citations.',
      inputSchema: { type: 'object', properties: {} },
      permissions: ['cite.list'],
      sideEffects: 'read',
      execute: (_input, ctx) => call('cite.list', {}, ctx),
    },
  ];
}
