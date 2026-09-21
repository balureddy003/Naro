import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { RepoContextSource } from './repo-context.ts';

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'naro-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

test('snapshot returns git facts plus repo instruction files', async () => {
  const dir = await repo();
  try {
    await writeFile(join(dir, 'AGENTS.md'), 'always run tests before completing');
    await writeFile(join(dir, 'README.md'), '# demo repo');
    const items = await new RepoContextSource({ root: dir }).snapshot();

    const git = items.find((i) => i.id === 'repo:git');
    assert.ok(git);
    assert.match(String(git.content), /branch: (main|master)/);
    assert.match(String(git.content), /init/);

    const agents = items.find((i) => i.id === 'repo:AGENTS.md');
    assert.match(String(agents?.content), /run tests before completing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('non-git directories yield file facts only — no error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-repo-'));
  try {
    await writeFile(join(dir, 'README.md'), '# plain dir');
    const items = await new RepoContextSource({ root: dir }).snapshot();
    assert.equal(items.find((i) => i.id === 'repo:git'), undefined);
    assert.ok(items.find((i) => i.id === 'repo:README.md'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('retrieve() ignores the query — stable facts are query-independent', async () => {
  const dir = await repo();
  try {
    const src = new RepoContextSource({ root: dir });
    const a = await src.retrieve('anything');
    const b = await src.retrieve('something else');
    assert.deepEqual(a.map((i) => i.id), b.map((i) => i.id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
