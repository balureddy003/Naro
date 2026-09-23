#!/usr/bin/env node
// Stop: mark a session boundary in the journal. Does NOT kill the server —
// Stop fires on every turn end (including resume/compact), and a
// conversation often continues after one; killing the server here would
// silently degrade later tool calls to fail-open-only until the next
// SessionStart. Repeated /end calls are harmless (each is just another
// agent.completed event in the journal).
import { readFile } from 'node:fs/promises';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const PORT_FILE = `${REPO_ROOT}.naro/dogfood.port`;

async function main() {
  let port;
  try {
    port = (await readFile(PORT_FILE, 'utf8')).trim();
  } catch {
    return;
  }
  try {
    await fetch(`http://127.0.0.1:${port}/end`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // best-effort
  }
}

await main();
console.log(JSON.stringify({}));
