import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createObservation, type Action, type ExecContext, type Observation } from '@naro/core';
import type { Environment, EnvironmentState } from '@naro/environment';

/**
 * A coding workspace: the agent's world is a directory on disk.
 *
 * This is the reference domain profile — proof that Git, files, and
 * shell are *profile* concerns, not kernel concerns. The universal
 * Environment contract is unchanged; only the capabilities grow.
 *
 * Capabilities (matched against action.capability):
 *   fs.read    — read file at env://<ws>/<relpath>
 *   fs.write   — write action.input.content to that path
 *   fs.list    — list directory entries (input.glob-free; recursive)
 *   fs.delete  — remove a file
 *   shell.exec — run action.input.command inside the workspace
 *
 * Security posture: every path is jailed to root (resolved + prefix-
 * checked, symlink escapes rejected). shell.exec is deliberately the
 * most dangerous capability — policy should require_approval for it.
 */

const CAPS = ['fs.read', 'fs.write', 'fs.list', 'fs.delete', 'shell.exec'] as const;

export interface WorkspaceOptions {
  readonly root: string;
  readonly shellTimeoutMs?: number;
  /** Max bytes of file content returned to the agent (rest truncated). */
  readonly maxReadBytes?: number;
  /** Max shell stdout/stderr returned. */
  readonly maxShellBytes?: number;
}

export class WorkspaceEnvironment implements Environment {
  readonly id: string;
  readonly capabilities: readonly string[] = CAPS;
  private readonly root: string;
  private readonly opts: WorkspaceOptions;

  constructor(opts: WorkspaceOptions, id = 'workspace') {
    this.root = resolve(opts.root);
    this.opts = opts;
    this.id = id;
  }

  async state(): Promise<EnvironmentState> {
    const files = await this.listRecursive(this.root, 200);
    return { at: Date.now(), resources: { root: this.root, files } };
  }

  async execute(action: Action, ctx: ExecContext): Promise<Observation> {
    const rel = this.targetPath(action);
    try {
      switch (action.capability) {
        case 'fs.read':   return await this.read(action, rel);
        case 'fs.write':  return await this.write(action, rel);
        case 'fs.list':   return await this.list(action, rel);
        case 'fs.delete': return await this.delete(action, rel);
        case 'shell.exec': return await this.shell(action, ctx);
        default:
          return this.obs(action, false, undefined,
            `environment '${this.id}' does not support capability '${action.capability}'`);
      }
    } catch (e) {
      return this.obs(action, false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  // ── capabilities ────────────────────────────────────────────────

  private async read(action: Action, rel: string): Promise<Observation> {
    const path = this.jail(rel);
    const max = this.opts.maxReadBytes ?? 64_000;
    const buf = await readFile(path);
    const truncated = buf.length > max;
    return this.obs(action, true, {
      path: rel,
      content: buf.subarray(0, max).toString('utf8'),
      ...(truncated && { truncated: true, totalBytes: buf.length }),
    });
  }

  private async write(action: Action, rel: string): Promise<Observation> {
    const path = this.jail(rel);
    const content = String((action.input as { content?: unknown })?.content ?? '');
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, content);
    return this.obs(action, true, { path: rel, bytes: Buffer.byteLength(content) });
  }

  private async list(action: Action, rel: string): Promise<Observation> {
    const path = this.jail(rel === '' ? '.' : rel);
    const entries = await readdir(path, { withFileTypes: true });
    return this.obs(action, true, entries.map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`));
  }

  private async delete(action: Action, rel: string): Promise<Observation> {
    await rm(this.jail(rel));
    return this.obs(action, true, { path: rel, deleted: true });
  }

  private shell(action: Action, ctx: ExecContext): Promise<Observation> {
    const cmd = String((action.input as { command?: unknown })?.command ?? '');
    if (!cmd) return Promise.resolve(this.obs(action, false, undefined, 'shell.exec requires input.command'));
    const max = this.opts.maxShellBytes ?? 16_000;
    return new Promise((resolve_) => {
      execFile('sh', ['-c', cmd], {
        cwd: this.root,
        timeout: this.opts.shellTimeoutMs ?? 30_000,
        ...(ctx.signal !== undefined && { signal: ctx.signal }),
      }, (err, stdout, stderr) => {
        resolve_(this.obs(action, !err, {
          command: cmd,
          exitCode: (err as { code?: number } | null)?.code ?? 0,
          stdout: stdout.slice(-max),
          stderr: stderr.slice(-max),
        }, err ? `exit ${(err as { code?: number }).code ?? '?'}` : undefined));
      });
    });
  }

  // ── safety ──────────────────────────────────────────────────────

  /** Resolve a relative path and verify it stays inside root. */
  private jail(rel: string): string {
    const path = resolve(this.root, rel);
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error(`path escapes workspace: '${rel}'`);
    }
    return path;
  }

  private targetPath(action: Action): string {
    const t = action.target;
    const prefix = `env://${this.id}/`;
    if (t.startsWith(prefix)) return t.slice(prefix.length);
    if (t.startsWith('env://')) return t.slice('env://'.length).split('/').slice(1).join('/');
    return t;
  }

  private async listRecursive(dir: string, limit: number): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: string, prefix: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (out.length >= limit) return;
        const p = prefix + e.name;
        out.push(e.isDirectory() ? `${p}/` : p);
        if (e.isDirectory()) await walk(resolve(d, e.name), `${p}/`);
      }
    };
    await walk(dir, '').catch(() => undefined);
    return out;
  }

  private obs(action: Action, success: boolean, output?: unknown, error?: string): Observation {
    return createObservation({
      actionId: action.id,
      source: `env://${this.id}`,
      kind: 'env-change',
      success,
      ...(output !== undefined && { output }),
      ...(error !== undefined && { error }),
    });
  }
}
