#!/usr/bin/env node
// PostToolUse(Bash): report the result to the dogfood server for
// journaling. Never blocks — the tool already ran; this only affects
// the evidence record, so any failure here is silent (best-effort).
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
    return {};
  }

  let port;
  try {
    port = (await readFile(PORT_FILE, 'utf8')).trim();
  } catch {
    return {};
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

console.log(JSON.stringify(await main()));
