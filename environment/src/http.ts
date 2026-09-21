import { createServer, type Server } from 'node:http';
import { createGoal, newId, type Action, type ExecContext, type Observation } from '@naro/core';
import type { Environment, EnvironmentState } from './environment.ts';

/**
 * Remote environments — the "hands as cattle" half of the session split.
 *
 * `serveEnvironment` exposes any Environment over HTTP; `HttpEnvironment`
 * is the client side implementing the same contract. The runner cannot
 * tell the difference: an authorized Action goes out, an Observation comes
 * back. Swapping a dead environment means pointing a new client at a new
 * URL — no runner changes.
 *
 * Endpoints:
 *   POST /execute   { action, ctx? } → Observation
 *   GET  /state     → EnvironmentState
 *   GET  /health    → { ok: true }
 *
 * This is a transport seam, not a security boundary — authn/z, TLS, and
 * network policy belong to the deployment in front of it. `token` adds a
 * shared-bearer check for deployments that want a minimal gate.
 */
export interface RemoteEnvOptions {
  readonly port?: number;
  readonly host?: string;
  /** When set, requests must carry `Authorization: Bearer <token>`. */
  readonly token?: string;
}

export function serveEnvironment(
  env: Environment,
  opts: RemoteEnvOptions = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (opts.token !== undefined) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${opts.token}`) return json(401, { error: 'unauthorized' });
    }

    if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/state') return json(200, await env.state());

    if (req.method === 'POST' && url.pathname === '/execute') {
      let body: { action?: Action; ctx?: Partial<ExecContext> };
      try { body = JSON.parse(await readBody(req)); }
      catch { return json(400, { error: 'invalid JSON' }); }
      if (!body.action) return json(400, { error: 'action required' });
      // Signals and secrets never cross the wire: the remote side rebuilds
      // identity context from what the client sent and applies its own.
      const ctx = {
        agentId: body.ctx?.agentId ?? 'remote',
        goalId: body.ctx?.goalId ?? 'remote',
        goal: body.ctx?.goal ?? createGoal({ description: 'remote' }),
        grants: body.ctx?.grants ?? [],
      } as ExecContext;
      try {
        return json(200, await env.execute(body.action, ctx));
      } catch (error) {
        return json(500, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    return json(404, { error: 'not found' });
  });

  const host = opts.host ?? '127.0.0.1';
  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, host, () => {
      const a = server.address();
      const port = typeof a === 'object' && a ? a.port : (opts.port ?? 0);
      resolve({ url: `http://${host}:${port}`, close: () => new Promise((c) => server.close(() => c())) });
    });
  });
}

/** Client side: an Environment that executes over HTTP. */
export class HttpEnvironment implements Environment {
  readonly id: string;
  readonly capabilities: readonly string[];
  private readonly url: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(url: string, opts: { id?: string; capabilities?: readonly string[]; token?: string; timeoutMs?: number } = {}) {
    this.url = url.replace(/\/$/, '');
    this.id = opts.id ?? 'http';
    this.capabilities = opts.capabilities ?? [];
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    if (opts.token !== undefined) this.token = opts.token;
  }

  async state(): Promise<EnvironmentState> {
    const res = await this.request('GET', '/state');
    if (!res.ok) throw new Error(`remote environment state failed: HTTP ${res.status}`);
    return res.json() as Promise<EnvironmentState>;
  }

  async execute(action: Action, ctx: ExecContext): Promise<Observation> {
    const res = await this.request('POST', '/execute', {
      action,
      ctx: { agentId: ctx.agentId, goalId: ctx.goalId, goal: ctx.goal, grants: ctx.grants },
    }, ctx.signal);
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        id: newId('obs'), at: Date.now(), actionId: action.id,
        source: `env://${this.id}`, kind: 'error', success: false, trust: 'tool',
        error: `remote environment HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      };
    }
    const obs = await res.json() as Observation;
    return { ...obs, actionId: action.id };
  }

  private request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    return fetch(`${this.url}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.token !== undefined && { authorization: `Bearer ${this.token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: signal ?? AbortSignal.timeout(this.timeoutMs),
    });
  }
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
