import { createAction, type ExecContext } from '@naro/core';
import type { Tool } from '@naro/tools';
import type { WorkspaceEnvironment } from './workspace.ts';

/**
 * Model-facing tools backed by a WorkspaceEnvironment.
 *
 * Why tools, not env:// actions: a model reasons over *named tools with
 * schemas* — `read_file(path)` is a better tool-call contract than a URI.
 * Each tool is a thin wrapper: it builds an env action and runs it
 * through the environment's own (jailed, capability-checked) path.
 *
 * Side-effect declarations matter: run_command is 'destructive' so the
 * default tool policy gates it behind human approval.
 */
export function codingTools(env: WorkspaceEnvironment): Tool[] {
  const call = async (
    capability: string, rel: string, input: unknown, ctx: ExecContext,
  ): Promise<unknown> => {
    const obs = await env.execute(
      createAction(ctx.agentId, { capability, target: `env://${env.id}/${rel}`, ...(input !== undefined && { input }) }),
      ctx,
    );
    if (!obs.success) throw new Error(obs.error ?? `${capability} failed`);
    return obs.output;
  };

  return [
    {
      name: 'read_file',
      description: 'Read a file in the workspace. Returns {path, content, truncated?}.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'workspace-relative path' } },
        required: ['path'],
      },
      permissions: ['fs.read'],
      sideEffects: 'read',
      execute: (input, ctx) => call('fs.read', String((input as { path: string }).path), undefined, ctx),
    },
    {
      name: 'write_file',
      description: 'Write content to a workspace file (creates parent directories).',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
      permissions: ['fs.write'],
      sideEffects: 'write',
      execute: (input, ctx) => {
        const { path, content } = input as { path: string; content: string };
        return call('fs.write', path, { content }, ctx);
      },
    },
    {
      name: 'list_files',
      description: 'List entries in a workspace directory (dirs end with /).',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'directory, default root' } },
      },
      permissions: ['fs.read'],
      sideEffects: 'read',
      execute: (input, ctx) => call('fs.list', String((input as { path?: string }).path ?? ''), undefined, ctx),
    },
    {
      name: 'delete_file',
      description: 'Delete a file in the workspace.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      permissions: ['fs.delete'],
      sideEffects: 'destructive',
      execute: (input, ctx) => call('fs.delete', String((input as { path: string }).path), undefined, ctx),
    },
    {
      name: 'run_command',
      description: 'Run a shell command inside the workspace. Returns {exitCode, stdout, stderr}.',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
      permissions: ['shell.exec'],
      sideEffects: 'destructive',
      execute: (input, ctx) =>
        call('shell.exec', 'shell', { command: (input as { command: string }).command }, ctx),
    },
  ];
}
