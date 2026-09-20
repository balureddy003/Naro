import { createAction, type ExecContext } from '@naro/core';
import type { Tool } from '@naro/tools';
import type { DataEnvironment } from './data-env.ts';

/** Model-facing tools over the data environment. */
export function dataTools(env: DataEnvironment): Tool[] {
  const call = async (cap: string, input: unknown, ctx: ExecContext): Promise<unknown> => {
    const obs = await env.execute(
      createAction(ctx.agentId, { capability: cap, target: `env://${env.id}/${cap}`, input }), ctx);
    if (!obs.success) throw new Error(obs.error ?? `${cap} failed`);
    return obs.output;
  };
  const sqlParams = {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'SQL with ? placeholders — never interpolate values' },
      params: { type: 'array', description: 'bound parameters, in order' },
    },
    required: ['sql'],
  } as const;
  return [
    {
      name: 'sql_query',
      description: 'Run a parameterized read query (SELECT/WITH). Returns {rows, rowCount, truncated?}.',
      inputSchema: sqlParams,
      permissions: ['sql.query'],
      sideEffects: 'read',
      execute: (input, ctx) => call('sql.query', input, ctx),
    },
    {
      name: 'sql_exec',
      description: 'Run a parameterized write (INSERT/UPDATE/DELETE/DDL). Returns {changes}.',
      inputSchema: sqlParams,
      permissions: ['sql.exec'],
      sideEffects: 'write',
      execute: (input, ctx) => call('sql.exec', input, ctx),
    },
    {
      name: 'sql_schema',
      description: 'List tables and columns — call this before writing queries.',
      inputSchema: { type: 'object', properties: {} },
      permissions: ['sql.schema'],
      sideEffects: 'read',
      execute: (_input, ctx) => call('sql.schema', {}, ctx),
    },
  ];
}
