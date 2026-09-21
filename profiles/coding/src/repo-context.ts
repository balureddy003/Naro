import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { ContextItem, ContextProvider } from '@naro/core';

/**
 * RepoContextSource — the "live repo context" a coding agent needs before
 * its first decision: git branch/status/recent commits plus the repo's own
 * agent instructions (AGENTS.md) and README.
 *
 * These are stable facts, so retrieval ignores the query — the runtime's
 * `need-context` path and an upfront `snapshot()` both get the same items.
 * Every git call is bounded (execFile, no shell, timeout) and every file
 * read is jailed to the workspace root.
 */
export class RepoContextSource implements ContextProvider {
  private readonly root: string;
  private readonly timeoutMs: number;
  /** Cap on file content per item — instructions, not dumps. */
  private readonly maxFileBytes: number;

  constructor(opts: { root: string; timeoutMs?: number; maxFileBytes?: number }) {
    this.root = resolve(opts.root);
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.maxFileBytes = opts.maxFileBytes ?? 16_384;
  }

  /** All repo facts as context items — order is stable: git, AGENTS.md, README. */
  async snapshot(): Promise<ContextItem[]> {
    const items: ContextItem[] = [];
    const git = await this.gitFacts();
    if (git) items.push(git);
    for (const name of ['AGENTS.md', 'CLAUDE.md', 'README.md']) {
      const item = await this.fileFact(name);
      if (item) items.push(item);
    }
    return items;
  }

  /** ContextProvider contract — repo facts are query-independent. */
  async retrieve(_query: string): Promise<readonly ContextItem[]> {
    return this.snapshot();
  }

  private async gitFacts(): Promise<ContextItem | undefined> {
    const [branch, status, log] = await Promise.all([
      this.git(['rev-parse', '--abbrev-ref', 'HEAD']),
      this.git(['status', '--porcelain', '-b']),
      this.git(['log', '--oneline', '-10']),
    ]);
    if (branch === undefined && status === undefined) return undefined; // not a repo
    const content = [
      `branch: ${branch ?? 'unknown'}`,
      'status:',
      status || '  clean',
      'recent commits:',
      log || '  (none)',
    ].join('\n');
    return { id: 'repo:git', source: 'repo:git', content };
  }

  private async fileFact(name: string): Promise<ContextItem | undefined> {
    const path = join(this.root, name);
    // Jail: the resolved path must stay under root (guards odd symlinks).
    const resolved = resolve(path);
    if (resolved !== this.root && !resolved.startsWith(this.root + sep)) return undefined;
    try {
      const raw = await readFile(resolved, 'utf8');
      const content = raw.length > this.maxFileBytes
        ? raw.slice(0, this.maxFileBytes) + `\n[… truncated at ${this.maxFileBytes} bytes]`
        : raw;
      return { id: `repo:${name}`, source: `repo:${name}`, content };
    } catch {
      return undefined; // file absent — fine
    }
  }

  private git(args: readonly string[]): Promise<string | undefined> {
    return new Promise((res) => {
      execFile('git', [...args], { cwd: this.root, timeout: this.timeoutMs, maxBuffer: 64 * 1024 },
        (err, stdout) => res(err ? undefined : stdout.trim()));
    });
  }
}
