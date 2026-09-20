import { createServer, type Server } from 'node:http';
import { newId, type Goal } from '@naro/core';
import type { AgentBus, AgentMessage } from './bus.ts';

/**
 * HTTP transport for AgentBus — the same two-method contract, now across
 * processes and machines.
 *
 * One HTTP server per process multiplexes every agent it hosts:
 *   POST {base}/agents/{id}/task   body: {goal, from, messageId}
 *   → {ok: true, result} | {ok: false, error}
 *
 * `resolve(agentId)` maps an agent id to its base URL — a static map
 * for dev, a directory service or DNS for real deployments. This is the
 * seam a full A2A adapter builds on; the wire is intentionally boring.
 */

export interface HttpBusOptions {
  /** agentId → base URL, e.g. { worker: 'http://localhost:9100' } */
  readonly resolve: (agentId: string) => string | undefined;
  /** Shared bearer token sent on every request. If set, the listener requires it. */
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
}

export class HttpAgentBus implements AgentBus {
  private readonly resolve: (id: string) => string | undefined;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly handlers = new Map<string, (msg: Extract<AgentMessage, { kind: 'task-request' }>) => Promise<unknown>>();
  private server?: Server;

  constructor(opts: HttpBusOptions) {
    this.resolve = opts.resolve;
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  serve(agentId: string, handler: (msg: Extract<AgentMessage, { kind: 'task-request' }>) => Promise<unknown>): void {
    this.handlers.set(agentId, handler);
  }

  /** Start listening; returns the base URL to register in `resolve`. */
  listen(port = 0, host = '127.0.0.1'): Promise<{ url: string; close: () => Promise<void> }> {
    this.server = createServer(async (req, res) => {
      const m = /^\/agents\/([^/]+)\/task$/.exec(req?.url ?? '');
      if (req?.method !== 'POST' || !m) {
        res.writeHead(404).end('not found');
        return;
      }
      if (this.token !== undefined && req.headers['authorization'] !== `Bearer ${this.token}`) {
        res.writeHead(401).end('unauthorized');
        return;
      }
      const handler = this.handlers.get(decodeURIComponent(m[1]!));
      if (!handler) { res.writeHead(404).end('no such agent'); return; }
      try {
        const body = JSON.parse(await readBody(req)) as { goal: Goal; from: string; messageId?: string };
        const result = await handler({
          kind: 'task-request', id: body.messageId ?? newId('msg'),
          from: body.from, goal: body.goal, at: Date.now(),
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (e) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
    });
    return new Promise((resolveListen) => {
      this.server!.listen(port, host, () => {
        const addr = this.server!.address();
        const p = typeof addr === 'object' && addr ? addr.port : port;
        resolveListen({
          url: `http://${host}:${p}`,
          close: () => new Promise((r) => this.server!.close(() => r())),
        });
      });
    });
  }

  async request(to: string, goal: Goal, from: string, timeoutMs = 30_000): Promise<unknown> {
    const base = this.resolve(to);
    if (!base) throw new Error(`no endpoint registered for agent '${to}'`);
    const res = await this.fetchImpl(`${base}/agents/${encodeURIComponent(to)}/task`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token !== undefined && { authorization: `Bearer ${this.token}` }),
      },
      body: JSON.stringify({ goal, from, messageId: newId('msg') }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`agent '${to}' HTTP ${res.status}`);
    const body = await res.json() as { ok: boolean; result?: unknown; error?: string };
    if (!body.ok) throw new Error(body.error ?? `agent '${to}' failed`);
    return body.result;
  }
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => resolveBody(s));
    req.on('error', reject);
  });
}
