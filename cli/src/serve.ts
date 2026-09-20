import { createServer, type Server } from 'node:http';
import { newId, createGoal, type NaroEvent } from '@naro/core';
import type { AgentRunner } from '@naro/runtime';

/**
 * `naro serve <agent-module>` — a Naro agent as a service.
 *
 * The module must export:
 *   createRunner(goal: Goal): AgentRunner
 *
 * Endpoints:
 *   POST /goals              {description, successCriteria?} → {runId}
 *   GET  /runs               → [{runId, status}]
 *   GET  /runs/:id           → {status, result?|error?}
 *   GET  /runs/:id/events    → SSE stream of the run's journal
 *   GET  /health             → {ok: true}
 *
 * This is a development/service seam — authn/z, TLS, and horizontal
 * routing belong to the deployment in front of it.
 */

export type RunnerFactory = (goal: ReturnType<typeof createGoal>) => AgentRunner;

interface RunRecord {
  id: string;
  runner: AgentRunner;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  result?: unknown;
  error?: string;
}

export function startAgentServer(factory: RunnerFactory, opts: { port?: number; host?: string } = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const runs = new Map<string, RunRecord>();

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true });

    if (req.method === 'GET' && url.pathname === '/runs') {
      return json(200, [...runs.values()].map((r) => ({ runId: r.id, status: r.status })));
    }

    const runMatch = /^\/runs\/([^/]+)(\/events)?$/.exec(url.pathname);
    if (req.method === 'GET' && runMatch) {
      const rec = runs.get(runMatch[1]!);
      if (!rec) return json(404, { error: 'unknown run' });

      if (runMatch[2] === '/events') {
        // SSE: runner.events() replays the journal then live-tails;
        // the stream ends after the run's terminal event.
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        void (async () => {
          for await (const e of rec.runner.events()) {
            res.write(`data: ${JSON.stringify(e)}\n\n`);
            if (['agent.completed', 'agent.failed', 'agent.cancelled'].includes(e.type)) break;
          }
          res.end();
        })();
        return;
      }
      return json(200, { runId: rec.id, status: rec.status, ...(rec.result !== undefined && { result: rec.result }), ...(rec.error !== undefined && { error: rec.error }) });
    }

    if (req.method === 'POST' && url.pathname === '/goals') {
      let body: { description?: string; successCriteria?: string[] };
      try { body = JSON.parse(await readBody(req)); }
      catch { return json(400, { error: 'invalid JSON' }); }
      if (!body.description) return json(400, { error: 'goal.description required' });

      const goal = createGoal({ description: body.description, successCriteria: body.successCriteria ?? [] });
      const rec: RunRecord = { id: newId('run'), runner: factory(goal), status: 'running' };
      runs.set(rec.id, rec);
      rec.runner.run().then((r) => {
        rec.status = r.status;
        if (r.result !== undefined) rec.result = r.result;
        if (r.error !== undefined) rec.error = r.error;
      }).catch((e) => { rec.status = 'failed'; rec.error = e instanceof Error ? e.message : String(e); });
      return json(202, { runId: rec.id });
    }

    return json(404, { error: 'not found' });
  });

  const host = opts.host ?? '127.0.0.1';
  return new Promise((r) => {
    server.listen(opts.port ?? 8080, host, () => {
      const a = server.address();
      const p = typeof a === 'object' && a ? a.port : (opts.port ?? 8080);
      r({ url: `http://${host}:${p}`, close: () => new Promise((c) => server.close(() => c())) });
    });
  });
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
