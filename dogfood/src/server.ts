import { createServer } from 'node:http';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createGoal } from '@naro/core';
import { harnessKernel } from '@naro/adapter-harness';
import { claudeHooks, type ClaudePreToolInput, type ClaudePostToolInput } from '@naro/adapter-harness';
import { JsonlExporter, pipeTo } from '@naro/observability';
import { dogfoodPolicy } from './policy.ts';

/**
 * One long-lived HarnessKernel behind a loopback HTTP server, so Claude
 * Code's per-tool-call hook subprocesses (each a fresh process — see
 * claude.ts's doc comment) share one kernel instance across the session.
 * That's what lets HarnessKernel.observeTool() join a PostToolUse result
 * back to its PreToolUse gate verdict by callId.
 *
 * Journal: every event streams live to .naro/dogfood-journal.jsonl via
 * JsonlExporter — durable even if this process is killed mid-session.
 * `naro verify .naro/dogfood-journal.jsonl` checks it like any other run.
 */

const JOURNAL_PATH = '.naro/dogfood-journal.jsonl';
const PORT_FILE = '.naro/dogfood.port';

const kernel = harnessKernel({
  agentId: 'claude-code-session',
  goal: 'Assist with development on the Naro repository, governed by this repo\'s own policy gate.',
  policy: dogfoodPolicy,
});

const exporter = new JsonlExporter(JOURNAL_PATH);
const piped = pipeTo(kernel.bus, exporter);
kernel.startSession();

const hooks = claudeHooks(kernel);

async function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length > 0 ? JSON.parse(text) : {};
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/pre') {
      const input = await readBody(req) as ClaudePreToolInput & { tool_use_id?: string };
      const out = await hooks.preToolUse(input, input.tool_use_id);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    }
    if (req.method === 'POST' && req.url === '/post') {
      const input = await readBody(req) as ClaudePostToolInput & { tool_use_id?: string };
      const out = await hooks.postToolUse(input, input.tool_use_id);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    }
    if (req.method === 'POST' && req.url === '/end') {
      const body = await readBody(req) as { result?: unknown; error?: string };
      await kernel.endSession(body);
      await piped.flush();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (err) {
    // Never let a bug here look like anything other than "server broken" —
    // callers (the hook scripts) are responsible for failing open on this.
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(0, '127.0.0.1', async () => {
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await mkdir(dirname(PORT_FILE), { recursive: true });
  await writeFile(PORT_FILE, String(port));
  // eslint-disable-next-line no-console
  console.error(`naro dogfood server listening on 127.0.0.1:${port}, journal: ${JOURNAL_PATH}`);
});

async function shutdown(): Promise<void> {
  await piped.flush().catch(() => {});
  await rm(PORT_FILE, { force: true }).catch(() => {});
  server.close();
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
