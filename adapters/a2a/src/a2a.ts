import { createServer, type Server } from 'node:http';
import { createGoal, newId, type Goal } from '@naro/core';
import type { AgentBus, AgentDescriptor, AgentMessage } from '@naro/multiagent';

/**
 * A2A (Agent2Agent) adapter — the spec-shaped transport for AgentBus.
 *
 * What the protocol contributes beyond raw HTTP:
 *   - an Agent Card at GET /.well-known/agent.json (discoverable
 *     identity + capabilities — this is how agents find each other)
 *   - JSON-RPC 2.0 task methods: tasks/send → completed task with
 *     result artifacts
 *
 * This is the honest subset: cards + synchronous tasks/send. Push
 * notifications, SSE streaming, and multi-turn tasks are spec features
 * that layer on later — the bus seam stays unchanged.
 */

export interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly version: string;
  readonly capabilities: { streaming: boolean; pushNotifications: boolean };
  readonly skills: readonly { id: string; name: string; description: string }[];
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: unknown;
}

export class A2aAgentBus implements AgentBus {
  private readonly resolveCard: (agentId: string) => Promise<AgentCard | undefined>;
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;
  private readonly handlers = new Map<string, (msg: Extract<AgentMessage, { kind: 'task-request' }>) => Promise<unknown>>();
  private card?: Omit<AgentCard, 'url'>;
  private readonly tasks = new Map<string, unknown>();
  private server?: Server;

  constructor(opts: {
    /** agentId → base URL, or fetch the agent card first for discovery. */
    resolve: (agentId: string) => string | undefined;
    token?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.resolveCard = async (agentId) => {
      const base = opts.resolve(agentId);
      if (!base) return undefined;
      try {
        const res = await this.fetchImpl(`${base}/.well-known/agent.json`, this.headers());
        return res.ok ? await res.json() as AgentCard : undefined;
      } catch { return undefined; }
    };
  }

  serve(agentId: string, handler: (msg: Extract<AgentMessage, { kind: 'task-request' }>) => Promise<unknown>): void {
    this.handlers.set(agentId, handler);
  }

  /** Publish this process's agent card (served at /.well-known/agent.json). */
  advertise(card: Omit<AgentCard, 'url'>): void {
    this.card = card;
  }

  async request(to: string, goal: Goal, from: string, timeoutMs = 30_000): Promise<unknown> {
    const card = await this.resolveCard(to);
    if (!card) throw new Error(`no A2A endpoint for agent '${to}'`);
    // Current-spec binding: message/send with kind-tagged parts.
    // tasks/send (deprecated in A2A v1) is still accepted server-side.
    const rpc: JsonRpcRequest = {
      jsonrpc: '2.0', id: newId('rpc'), method: 'message/send',
      params: { id: newId('task'), message: { role: 'user', parts: [{ kind: 'text', text: goal.description }] }, metadata: { from } },
    };
    const res = await this.fetchImpl(card.url.replace(/\/$/, '') + '/', {
      method: 'POST', ...this.headers(), body: JSON.stringify(rpc),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`A2A '${to}' HTTP ${res.status}`);
    const body = await res.json() as {
      result?: { status: { state: string }; artifacts?: { parts: { kind?: string; type?: string; text?: string }[] }[] };
      error?: { message: string };
    };
    if (body.error) throw new Error(`A2A error: ${body.error.message}`);
    const task = body.result;
    if (task?.status.state !== 'completed') {
      throw new Error(`A2A task ended '${task?.status.state ?? 'unknown'}'`);
    }
    const text = task.artifacts?.flatMap((a) => a.parts)
      .filter((p) => (p.kind ?? p.type) === 'text').map((p) => p.text ?? '').join('\n');
    return text ?? task;
  }

  /** Serve the agent card + JSON-RPC endpoint. */
  listen(port = 0, host = '127.0.0.1'): Promise<{ url: string; close: () => Promise<void> }> {
    this.server = createServer(async (req, res) => {
      const url = req?.url ?? '';
      if (req?.method === 'GET' && url === '/.well-known/agent.json') {
        if (!this.card) { res.writeHead(404).end('no card advertised'); return; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ...this.card, url: this.baseUrl() }));
        return;
      }
      if (req?.method === 'POST' && (url === '/' || url === '/rpc')) {
        if (this.token !== undefined && req.headers['authorization'] !== `Bearer ${this.token}`) {
          res.writeHead(401).end('unauthorized'); return;
        }
        await this.handleRpc(req, res);
        return;
      }
      res.writeHead(404).end('not found');
    });
    return new Promise((r) => {
      this.server!.listen(port, host, () => {
        const a = this.server!.address();
        const p = typeof a === 'object' && a ? a.port : port;
        r({ url: `http://${host}:${p}`, close: () => new Promise((c) => this.server!.close(() => c())) });
      });
    });
  }

  private async handleRpc(req: NodeJS.ReadableStream, res: NodeJS.WritableStream & { writeHead(s: number, h?: object): unknown; end(s: string): void }): Promise<void> {
    const respond = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let rpc: JsonRpcRequest;
    try {
      rpc = JSON.parse(await readBody(req)) as JsonRpcRequest;
    } catch { respond({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }

    if (rpc.method === 'tasks/get') {
      const p = rpc.params as { id?: string };
      const task = p?.id ? this.tasks.get(p.id) : undefined;
      respond(task
        ? { jsonrpc: '2.0', id: rpc.id, result: task }
        : { jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: `unknown task '${p?.id}'` } });
      return;
    }
    if (rpc.method !== 'message/send' && rpc.method !== 'tasks/send') {
      respond({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `unknown method ${rpc.method}` } });
      return;
    }
    const params = rpc.params as {
      id?: string;
      message?: { parts?: { kind?: string; type?: string; text?: string }[] };
      metadata?: { from?: string };
    };
    const text = params?.message?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const agentId = this.card?.name ?? 'agent';
    const handler = this.handlers.get(agentId) ?? this.handlers.values().next().value;
    if (!handler) {
      respond({ jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'no agent serving' } });
      return;
    }
    try {
      const result = await handler({
        kind: 'task-request', id: params?.id ?? newId('task'),
        from: params?.metadata?.from ?? 'unknown',
        goal: createGoal({ description: text }),
        at: Date.now(),
      });
      const task = {
        id: params?.id ?? newId('task'),
        status: { state: 'completed', timestamp: new Date().toISOString() },
        artifacts: [{ parts: [{ kind: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] }],
      };
      this.tasks.set(task.id, task);
      respond({ jsonrpc: '2.0', id: rpc.id, result: task });
    } catch (e) {
      const task = {
        id: params?.id ?? newId('task'),
        status: { state: 'failed', timestamp: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) },
      };
      this.tasks.set(task.id, task);
      respond({ jsonrpc: '2.0', id: rpc.id, result: task });
    }
  }

  private baseUrl(): string {
    const a = this.server?.address();
    return typeof a === 'object' && a ? `http://127.0.0.1:${a.port}` : '';
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.token !== undefined && { authorization: `Bearer ${this.token}` }),
    };
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

/** An advertised card doubles as an AgentDirectory entry. */
export function cardToDescriptor(card: AgentCard): AgentDescriptor {
  return {
    id: card.name,
    name: card.name,
    capabilities: card.skills.map((s) => s.id),
  };
}
