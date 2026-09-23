#!/usr/bin/env node
// PreToolUse(Bash): ask the dogfood server's policy gate. Fails OPEN on
// any error (server not up, timeout, bad response) — a bug here must
// never be able to lock out a Claude Code session on this repo. See
// dogfood/README.md "Honest scope".
import { readFile } from 'node:fs/promises';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const PORT_FILE = `${REPO_ROOT}.naro/dogfood.port`;

async function main() {
  let input;
  try {
    const raw = await new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { data += c; });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
    input = raw.length > 0 ? JSON.parse(raw) : {};
  } catch {
    return {}; // malformed input — proceed, don't block on our own parse bug
  }

  let port;
  try {
    port = (await readFile(PORT_FILE, 'utf8')).trim();
  } catch {
    return {}; // server never started — fail open
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/pre`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {}; // unreachable/timeout — fail open
  }
}

console.log(JSON.stringify(await main()));
