import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { newId, createGoal, type NaroEvent } from '@naro/core';
import { InMemoryRunRegistry, type AgentRunner, type ApprovalRequest, type RunRegistry } from '@naro/runtime';

/**
 * `naro serve <agent-module>` — a Naro agent as a service.
 *
 * The module must export:
 *   createRunner(goal: Goal): AgentRunner
 *
 * Endpoints:
 *   POST /goals              {description, successCriteria?} → {runId}
 *   GET  /runs               → [{runId, status, agentId, goal, ...}]
 *   GET  /runs/:id           → {status, result?|error?}
 *   GET  /runs/:id/events    → SSE stream of the run's journal
 *   GET  /approvals          → pending human-in-the-loop requests
 *   POST /approvals/:id      {approved?|text?|note?} → {ok}
 *   GET  /health             → {ok: true}        (liveness — process up)
 *   GET  /ready              → {ready: bool}     (readiness — deps reachable)
 *
 * Deployment notes: `principals` maps bearer tokens to identities + roles
 * (viewer / operator / approver); `token` is the legacy shorthand for one
 * admin principal. Either gates everything except the probes (orchestrators
 * probe without auth). `close()` drains — it cancels in-flight runs so
 * their journals end with `agent.cancelled`, then stops accepting
 * connections. TLS and tenant authz belong to the deployment in front of it.
 *
 * `registry` is the durable run index — every run is upserted there, so
 * /runs survives a replica restart and is shared between replicas pointed
 * at the same store. `journal` lets /runs/:id/events replay a run this
 * replica doesn't own. `approvals` exposes a shared HumanBridge's queue.
 */

export type RunnerFactory = (goal: ReturnType<typeof createGoal>) => AgentRunner;

/** A control-plane identity: an id plus the roles it holds. */
export interface Principal {
  readonly id: string;
  readonly roles: ReadonlySet<string>;
}

/**
 * Endpoint → minimum role. `viewer` reads runs and the approval queue,
 * `operator` submits goals, `approver` answers approvals. operator and
 * approver each imply viewer.
 */
type Role = 'viewer' | 'operator' | 'approver';

function requiredRole(method: string, path: string): Role | undefined {
  if (method === 'POST' && path === '/goals') return 'operator';
  if (method === 'POST' && /^\/approvals\/[^/]+$/.test(path)) return 'approver';
  if (method === 'GET' && (path === '/runs' || path === '/approvals' || /^\/runs\/[^/]+(\/events)?$/.test(path))) return 'viewer';
  return undefined;
}

/** operator/approver imply viewer — expand so checks are a single has(). */
function expandRoles(roles: readonly string[]): ReadonlySet<string> {
  const s = new Set(roles);
  if (s.has('operator') || s.has('approver')) s.add('viewer');
  return s;
}

export interface ServeOptions {
  readonly port?: number;
  readonly host?: string;
  /** Shared bearer token required on all endpoints except /health and /ready. */
  readonly token?: string;
  /** Token→principal map: {id, roles}. supersedes `token` (which maps to one admin principal). */
  readonly principals?: Readonly<Record<string, { id: string; roles: readonly string[] }>>;
  /** Readiness probe — throw or return false when a dependency is down. */
  readonly ready?: () => Promise<boolean> | boolean;
  /** POST /goals body cap in bytes — goals are small. Default 64 KiB. */
  readonly maxBodyBytes?: number;
  /** Durable run index backing /runs. Default: in-memory. */
  readonly registry?: RunRegistry;
  /** Journal source for runs a peer replica owns (cross-replica events). */
  readonly journal?: { history(filter: { runId?: string }): Promise<readonly NaroEvent[]> | readonly NaroEvent[] };
  /** Shared approval queue — e.g. SqliteApprovalBridge. Enables /approvals. */
  readonly approvals?: {
    pending(): ApprovalRequest[] | Promise<ApprovalRequest[]>;
    respond(id: string, answer: { approved?: boolean; text?: string; note?: string }, by?: string): boolean | Promise<boolean>;
  };
}

interface RunRecord {
  id: string;
  runner: AgentRunner;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  result?: unknown;
  error?: string;
  /** Cancellation channel — close() aborts in-flight runs. */
  signal: AbortController;
}

export function startAgentServer(factory: RunnerFactory, opts: ServeOptions = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const runs = new Map<string, RunRecord>();
  const registry = opts.registry ?? new InMemoryRunRegistry();
  const hostName = hostname();
  const maxBody = opts.maxBodyBytes ?? 65_536;
  let draining = false;

  // `principals` supersedes `token`; the legacy flag is one admin principal.
  const principals: Readonly<Record<string, { id: string; roles: readonly string[] }>> | undefined =
    opts.principals ?? (opts.token !== undefined
      ? { [opts.token]: { id: 'token', roles: ['viewer', 'operator', 'approver'] } }
      : undefined);

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    // This callback is async, so an uncaught throw anywhere below — a
    // factory(goal) that throws synchronously, a store method that
    // rejects, anything — becomes an unhandled promise rejection, and
    // Node's default is to crash the whole process, taking every other
    // in-flight run down with one bad request. One request failing must
    // never mean the control plane failing.
    try {
      return await route();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!res.headersSent) return json(500, { error: message });
      res.end(); // a stream (SSE) was already writing — nothing left to do but close it
      return;
    }

    async function route(): Promise<void> {
    // Probes never require auth — orchestrators can't carry credentials.
    if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/ready') {
      if (draining) return json(503, { ready: false, reason: 'draining' });
      try {
        const ready = opts.ready ? await opts.ready() : true;
        return json(ready ? 200 : 503, { ready });
      } catch (e) {
        return json(503, { ready: false, reason: e instanceof Error ? e.message : 'probe failed' });
      }
    }

    // Authn: bearer token → principal. Authz: the route's required role.
    // Neither configured → the control plane is open (dev default).
    let principal: Principal | undefined;
    if (principals !== undefined) {
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const p = bearer !== undefined ? principals[bearer] : undefined;
      if (p === undefined) return json(401, { error: 'unauthorized' });
      principal = { id: p.id, roles: expandRoles(p.roles) };
      const required = requiredRole(req.method ?? '', url.pathname);
      if (required !== undefined && !principal.roles.has(required)) {
        return json(403, { error: 'forbidden', required });
      }
    }

    if (req.method === 'GET' && url.pathname === '/runs') {
      const list = await registry.list({ limit: 200 });
      return json(200, list.map((r) => ({
        runId: r.runId, status: r.status, agentId: r.agentId, goal: r.goal,
        startedAt: r.startedAt, updatedAt: r.updatedAt, ...(r.host !== undefined && { host: r.host }),
      })));
    }

    const runMatch = /^\/runs\/([^/]+)(\/events)?$/.exec(url.pathname);
    if (req.method === 'GET' && runMatch) {
      const rec = runs.get(runMatch[1]!);

      if (runMatch[2] === '/events') {
        if (rec) {
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
        if (opts.journal) {
          // A peer replica owns the live run; the journal is the shared truth.
          const events = await opts.journal.history({ runId: runMatch[1]! });
          if (events.length === 0) return json(404, { error: 'unknown run' });
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
          res.end();
          return;
        }
        return json(404, { error: 'run not on this replica; configure journal for cross-replica reads' });
      }

      const summary = await registry.get(runMatch[1]!);
      if (!summary) return json(404, { error: 'unknown run' });
      return json(200, summary);
    }

    if (req.method === 'GET' && url.pathname === '/approvals') {
      if (!opts.approvals) return json(501, { error: 'approvals not configured' });
      return json(200, await opts.approvals.pending());
    }

    const approvalMatch = /^\/approvals\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'POST' && approvalMatch) {
      if (!opts.approvals) return json(501, { error: 'approvals not configured' });
      let body: { approved?: boolean; text?: string; note?: string };
      try { body = JSON.parse(await readBody(req, maxBody)); }
      catch (e) {
        return json(e instanceof Error && e.message === 'too-large' ? 413 : 400,
          { error: e instanceof Error && e.message === 'too-large' ? 'body too large' : 'invalid JSON' });
      }
      // `by` attributes the answer to the calling principal — the bridge
      // persists it and the runner journals it on human.approval.received.
      const done = await opts.approvals.respond(approvalMatch[1]!, body ?? {}, principal?.id);
      return done ? json(200, { ok: true }) : json(404, { error: 'no pending request' });
    }

    if (req.method === 'POST' && url.pathname === '/goals') {
      if (draining) return json(503, { error: 'draining — not accepting new runs' });
      let body: { description?: string; successCriteria?: string[]; idempotencyKey?: string };
      try { body = JSON.parse(await readBody(req, maxBody)); }
      catch (e) {
        return json(e instanceof Error && e.message === 'too-large' ? 413 : 400,
          { error: e instanceof Error && e.message === 'too-large' ? 'body too large' : 'invalid JSON' });
      }
      if (!body.description) return json(400, { error: 'goal.description required' });

      // At-least-once submission needs idempotent acceptance: a retry with
      // the same key returns the same run instead of double-running.
      const id = body.idempotencyKey !== undefined
        ? `run_${createHash('sha256').update(body.idempotencyKey).digest('hex').slice(0, 32)}`
        : newId('run');
      // The registry is the shared truth — a retry may hit a different
      // replica; the local map is only this process's live handles.
      const known = (await registry.get(id)) ?? runs.get(id);
      if (known) {
        return json(200, { runId: 'runId' in known ? known.runId : known.id, status: known.status, deduplicated: true });
      }

      const goal = createGoal({ description: body.description, successCriteria: body.successCriteria ?? [] });
      const rec: RunRecord = { id, runner: factory(goal), status: 'running', signal: new AbortController() };
      runs.set(rec.id, rec);
      const startedAt = Date.now();
      let agentId = '';
      // goal.started carries the agent's identity and the goal text —
      // index the run the moment its journal begins.
      rec.runner.on('goal.started', (e) => {
        agentId = e.agentId;
        void registry.upsert({
          runId: rec.id, agentId, status: 'running', goal: e.data.goal.description,
          startedAt, updatedAt: Date.now(), host: hostName,
        });
      });
      // The API runId IS the journal runId — events, exports, and wake(runId)
      // all correlate with the id this endpoint returned.
      rec.runner.run({ signal: rec.signal.signal, runId: rec.id }).then((r) => {
        rec.status = r.status;
        if (r.result !== undefined) rec.result = r.result;
        if (r.error !== undefined) rec.error = r.error;
        void registry.upsert({
          runId: rec.id, agentId, status: r.status, goal: goal.description,
          startedAt, updatedAt: Date.now(), host: hostName,
          ...(r.result !== undefined && { result: r.result }),
          ...(r.error !== undefined && { error: r.error }),
        });
      }).catch((e) => {
        rec.status = 'failed'; rec.error = e instanceof Error ? e.message : String(e);
        void registry.upsert({
          runId: rec.id, agentId, status: 'failed', goal: goal.description,
          startedAt, updatedAt: Date.now(), host: hostName, error: rec.error,
        });
      });
      return json(202, { runId: rec.id });
    }

    return json(404, { error: 'not found' });
    }
  });

  const host = opts.host ?? '127.0.0.1';
  return new Promise((r) => {
    server.listen(opts.port ?? 8080, host, () => {
      const a = server.address();
      const p = typeof a === 'object' && a ? a.port : (opts.port ?? 8080);
      r({
        url: `http://${host}:${p}`,
        // Drain: flip readiness, abort in-flight runs (their journals end
        // with agent.cancelled — evidence of the interruption), then close.
        close: async () => {
          draining = true;
          for (const rec of runs.values()) {
            if (rec.status === 'running') rec.signal.abort('server shutting down');
          }
          // Give cancellations a beat to land their terminal events.
          const pending = [...runs.values()].filter((x) => x.status === 'running');
          if (pending.length) await Promise.race([
            Promise.allSettled(pending.map((x) => new Promise((d) => {
              const t = setInterval(() => { if (x.status !== 'running') { clearInterval(t); d(null); } }, 25);
            }))),
            new Promise((d) => setTimeout(d, 5_000)),
          ]);
          await new Promise<void>((c) => server.close(() => c()));
          server.closeIdleConnections(); // keep-alive sockets don't hold close()
        },
      });
    });
  });
}

function readBody(req: import('node:http').IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '';
    let over = false;
    req.on('data', (c: Buffer) => {
      if (over) return; // drain the rest so the 413 can still be written
      s += c;
      if (Buffer.byteLength(s) > maxBytes) {
        over = true;
        reject(new Error('too-large'));
      }
    });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
