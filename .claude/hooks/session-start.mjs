#!/usr/bin/env node
// SessionStart: ensure the dogfood governance server is running for this
// repo. Idempotent — safe to fire more than once (resume, /clear, compact).
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const PORT_FILE = `${REPO_ROOT}.naro/dogfood.port`;

async function alreadyRunning() {
  let port;
  try {
    port = (await readFile(PORT_FILE, 'utf8')).trim();
  } catch {
    return false;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    // Stale port file from a dead process — clean it up.
    await rm(PORT_FILE, { force: true }).catch(() => {});
    return false;
  }
}

if (!(await alreadyRunning())) {
  const child = spawn(process.execPath, ['dogfood/src/server.ts'], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

console.log(JSON.stringify({}));
