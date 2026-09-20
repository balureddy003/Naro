#!/usr/bin/env node
/**
 * Publishing smoke check: `npm pack --dry-run` every public workspace and
 * assert the tarball actually contains the entrypoints package.json
 * advertises (exports/types). Catches the classic "published an empty
 * package" before a release does.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dirs = manifest.workspaces.flatMap((w) =>
  w.includes('*')
    ? readdirSync(join(root, w.replace('/*', ''))).map((d) => join(w.replace('/*', ''), d))
    : [w],
);

let failed = 0;
for (const dir of dirs) {
  const pkgPath = join(root, dir, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.private) continue;

  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: join(root, dir), encoding: 'utf8' });
  const files = JSON.parse(out)[0].files.map((f) => f.path);

  const problems = [];
  for (const entry of Object.values(pkg.exports ?? {})) {
    if (typeof entry === 'string' && !files.includes(entry.replace(/^\.\//, '')))
      problems.push(`missing export target ${entry}`);
  }
  if (pkg.types && !files.includes(pkg.types.replace(/^\.\//, '')))
    problems.push(`missing types ${pkg.types}`);
  if (!existsSync(join(root, dir, 'README.md')))
    problems.push('no README.md — published page would be blank');

  if (problems.length) {
    failed++;
    console.error(`✖ ${pkg.name}: ${problems.join('; ')}`);
  } else {
    console.log(`✔ ${pkg.name}@${pkg.version} — ${files.length} files`);
  }
}
process.exit(failed ? 1 : 0);
