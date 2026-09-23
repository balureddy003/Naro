import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, createGoal, type NaroEvent } from '@naro/core';
import { InMemoryRunRegistry, type AgentRunner, type ApprovalRequest, type RunRegistry } from '@naro/runtime';
import { buildEvidence, type PrunableEventStore } from '@naro/observability';
import type { ToolRegistry } from '@naro/tools';
import { generateToken, type PrincipalStore } from './principals.ts';
import { CONSOLE_HTML } from './console.ts';
import { CHAT_UI_HTML } from '@naro/chat-ui';

// Resolved once per process — @naro/client's compiled dist/ is plain,
// dependency-free ESM (fetch + AbortController + ReadableStream only), so
// serving its files as-is is a valid browser module graph with no bundler
// step. GET /client/* below serves exactly this directory.
let clientDistDir: string | undefined;
function resolveClientDist(): string {
  if (clientDistDir === undefined) {
    clientDistDir = dirname(fileURLToPath(import.meta.resolve('@naro/client')));
  }
  return clientDistDir;
}

// Same pattern for @naro/chat-ui's compiled ESM — GET /chat-ui/* serves
// its dist directory, allowlisted to module files only.
let chatDistDir: string | undefined;
function resolveChatDist(): string {
  if (chatDistDir === undefined) {
    chatDistDir = dirname(fileURLToPath(import.meta.resolve('@naro/chat-ui')));
  }
  return chatDistDir;
}

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
 *                              [?since=<seq>] resumes after that seq instead
 *                              of replaying the whole journal
 *   GET  /runs/:id/evidence  → EvidenceRecord — buildEvidence() over the
 *                              run's journal so far: policy verdict →
 *                              action → observation → verifier, correlated
 *                              server-side instead of by the client
 *   POST /runs/:id/cancel    {reason} → 202 — the Article 14 stop button:
 *                              aborts that run's AbortController; reason +
 *                              calling principal land on agent.cancelled
 *   POST /runs/cancel-all    {reason} → 202 — fleet-wide halt (admin role)
 *   GET  /approvals          → pending human-in-the-loop requests
 *   POST /approvals/:id      {approved?|text?|note?} → {ok}
 *   GET  /me                 → the caller's principal (ADR 0026)
 *   GET  /admin/tool-collisions          → pending name collisions (ADR 0024)
 *   POST /admin/tool-collisions/resolve  {name, sourceId} → promote a source
 *   GET  /admin/tool-definitions/changed → definitions changed since review
 *   POST /admin/tool-definitions/acknowledge {name, sourceId?} → restore
 *   POST /admin/runs/:id/prune           {throughSeq, policy?} → attested
 *                                        retention prune (ADR 0018)
 *   GET  /admin/principals    → principals, tokens shown as last-4 (ADR 0025)
 *   POST /admin/principals    {id?, roles, tenantId?} → {token} shown once
 *   DELETE /admin/principals/:id         → revoke
 *   GET  /health             → {ok: true}        (liveness — process up)
 *   GET  /ready              → {ready: bool}     (readiness — deps reachable)
 *   GET  /console            → the ops console (static HTML; see console.ts)
 *   GET  /chat               → the chat interface (PRD-006; @naro/chat-ui)
 *   GET  /chat-ui/*.js       → the chat UI's compiled module graph
 *
 * The console page itself carries no data and needs no auth to load (like
 * /health) — it's static HTML/JS. Every API call *it* makes goes through
 * the same bearer-token gate as any other client; the token lives in the
 * viewer's browser, never in this response. Disable the route entirely
 * with `console: false`.
 *
 * Deployment notes: `principals` maps bearer tokens to identities + roles
 * (viewer / operator / approver); `token` is the legacy shorthand for one
 * admin principal. Either gates everything except the probes (orchestrators
 * probe without auth). `close()` drains — it cancels in-flight runs so
 * their journals end with `agent.cancelled`, then stops accepting
 * connections. TLS and full tenant authorization still belong to the
 * deployment in front of this process — a principal's `tenantId` (see ADR
 * 0013) only scopes `/runs` visibility within one process; it is not
 * tenant isolation (shared policy engine, shared budgets, shared blast
 * radius) and it does not scope `/approvals`.
 *
 * `registry` is the durable run index — every run is upserted there, so
 * /runs survives a replica restart and is shared between replicas pointed
 * at the same store. `journal` lets /runs/:id/events replay a run this
 * replica doesn't own. `approvals` exposes a shared HumanBridge's queue.
 */

/**
 * The module's runner constructor. `info.principal` is the authenticated
 * caller (ADR 0017) — modules that want per-action "on behalf of" policy
 * decisions pass it to `AgentDeps.principal`.
 */
export type RunnerFactory = (
  goal: ReturnType<typeof createGoal>,
  info?: { principal?: Principal; template?: string },
) => AgentRunner;

/** A control-plane identity: an id, the roles it holds, and — see ADR
 *  0013 — the tenant its `/runs` visibility is scoped to, if any. */
export interface Principal {
  readonly id: string;
  readonly roles: ReadonlySet<string>;
  readonly tenantId?: string;
}

/**
 * Endpoint → minimum role. `viewer` reads runs and the approval queue,
 * `operator` submits goals, `approver` answers approvals. operator and
 * approver each imply viewer.
 */
type Role = 'viewer' | 'operator' | 'approver' | 'admin';

function requiredRole(method: string, path: string): Role | undefined {
  if (method === 'POST' && path === '/goals') return 'operator';
  // ADR 0022: single-run cancel is an operator action; fleet-wide halt is
  // admin — a strictly larger blast radius than any single-run route.
  if (method === 'POST' && path === '/runs/cancel-all') return 'admin';
  if (method === 'POST' && /^\/runs\/[^/]+\/cancel$/.test(path)) return 'operator';
  if (method === 'POST' && /^\/approvals\/[^/]+$/.test(path)) return 'approver';
  // ADR 0024/0025: every /admin/* route is admin-only — registry writes
  // and principal issuance are the widest blast radius on the surface.
  if (path.startsWith('/admin/')) return 'admin';
  if (method === 'GET' && (path === '/runs' || path === '/approvals' || /^\/runs\/[^/]+(\/events|\/evidence)?$/.test(path))) return 'viewer';
  return undefined;
}

/** operator/approver imply viewer; admin implies all —
 *  expand so checks are a single has(). */
function expandRoles(roles: Iterable<string>): ReadonlySet<string> {
  const s = new Set(roles);
  if (s.has('operator') || s.has('approver')) s.add('viewer');
  if (s.has('admin')) { s.add('operator'); s.add('approver'); s.add('viewer'); }
  return s;
}

export interface ServeOptions {
  readonly port?: number;
  readonly host?: string;
  /** Shared bearer token required on all endpoints except /health and /ready. */
  readonly token?: string;
  /** Token→principal map: {id, roles, tenantId?}. supersedes `token` (which
   *  maps to one admin principal with no tenant). `tenantId` scopes that
   *  principal's `/runs` visibility — see ADR 0013. */
  readonly principals?: Readonly<Record<string, { id: string; roles: readonly string[]; tenantId?: string }>>;
  /** Serve the read-only ops console at GET /console. Default true — the
   *  page itself needs no auth to load; every call it makes is gated
   *  normally. */
  readonly console?: boolean;
  /** Readiness probe — throw or return false when a dependency is down. */
  readonly ready?: () => Promise<boolean> | boolean;
  /** POST /goals body cap in bytes — goals are small. Default 64 KiB. */
  readonly maxBodyBytes?: number;
  /** Durable run index backing /runs. Default: in-memory. */
  readonly registry?: RunRegistry;
  /** Journal source for runs a peer replica owns (cross-replica events).
   *  When it also implements `PrunableEventStore` (ADR 0018),
   *  POST /admin/runs/:id/prune works; otherwise that route 501s. */
  readonly journal?: {
    history(filter: { runId?: string }): Promise<readonly NaroEvent[]> | readonly NaroEvent[];
    prune?: PrunableEventStore['prune'];
  };
  /** Shared approval queue — e.g. SqliteApprovalBridge. Enables /approvals. */
  readonly approvals?: {
    pending(): ApprovalRequest[] | Promise<ApprovalRequest[]>;
    respond(id: string, answer: { approved?: boolean; text?: string; note?: string }, by?: string): boolean | Promise<boolean>;
  };
  /** ADR 0024: the tool registry the admin collision/definition endpoints
   *  inspect and resolve against. Absent → those routes 501. Named
   *  `toolRegistry` because `registry` is already the run index. */
  readonly toolRegistry?: ToolRegistry;
  /** Ed25519 private key (PEM) used to attest admin prune markers. */
  readonly pruneSealKey?: string;
  /** ADR 0025: a live principal store — resolves bearer tokens per request
   *  and backs /admin/principals. Checked before the static `principals`
   *  map, not instead of it: the static map stays live as a bootstrap/
   *  break-glass path when both are configured, since POST
   *  /admin/principals itself needs an admin token to call and a
   *  freshly-created store starts with none. */
  readonly principalStore?: PrincipalStore;
  /** Serve the chat UI at GET /chat and its assets under /chat-ui/*.
   *  Default true — same static, auth-free-page posture as /console. */
  readonly chat?: boolean;
  /** The template objects the chat sidebar lists — the deployment's
   *  declared manifest, injected into the shell page (no endpoint). A
   *  run groups under a template when its specName is `tpl:<id>`. */
  readonly chatTemplates?: readonly { id: string; name: string; icon?: string; tagline?: string; configured?: boolean }[];
}

interface RunRecord {
  id: string;
  runner: AgentRunner;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  result?: unknown;
  error?: string;
  /** Cancellation channel — close() and POST /runs/:id/cancel abort it. */
  signal: AbortController;
  /** Owning tenant (ADR 0013) — cancel routes stay inside the caller's scope. */
  tenantId?: string;
}

export function startAgentServer(factory: RunnerFactory, opts: ServeOptions = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const runs = new Map<string, RunRecord>();
  const registry = opts.registry ?? new InMemoryRunRegistry();
  const hostName = hostname();
  const maxBody = opts.maxBodyBytes ?? 65_536;
  let draining = false;

  // `principals` supersedes `token`; the legacy flag is one admin principal
  // with no tenant (full visibility, matching its pre-ADR-0013 behavior).
  const principals: Readonly<Record<string, { id: string; roles: readonly string[]; tenantId?: string }>> | undefined =
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

    // Static, carries no data, needs no auth to load — same posture as the
    // probes. Every call the page itself makes is gated normally below.
    if (req.method === 'GET' && url.pathname === '/console' && opts.console !== false) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(CONSOLE_HTML);
      return;
    }

    // @naro/client's compiled module graph, served as-is — the console's
    // `<script type="module">` imports from here. Filename allowlisted
    // ([a-z0-9_-]+.js or .js.map) so the URL can never escape the dist
    // directory it's joined onto.
    const clientAsset = /^\/client\/([a-z0-9_-]+\.js(?:\.map)?)$/i.exec(url.pathname);
    if (req.method === 'GET' && clientAsset && opts.console !== false) {
      try {
        const body = await readFile(join(resolveClientDist(), clientAsset[1]!), 'utf8');
        const isMap = clientAsset[1]!.endsWith('.map');
        res.writeHead(200, { 'content-type': isMap ? 'application/json' : 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(body);
        return;
      } catch {
        return json(404, { error: 'not found' });
      }
    }

    // PRD-006: the chat interface — same static-page posture as /console
    // (no auth to load the shell; every API call it makes is gated below).
    if (req.method === 'GET' && url.pathname === '/chat' && opts.chat !== false) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(CHAT_UI_HTML.replace('__NARO_CHAT_CONFIG__',
        // '<' escaped so a template name containing '</script>' can't
        // break out of the inline config block.
        JSON.stringify({ templates: opts.chatTemplates ?? [] }).replace(/</g, '\\u003c')));
      return;
    }
    const chatAsset = /^\/chat-ui\/([a-z0-9_-]+\.js(?:\.map)?)$/i.exec(url.pathname);
    if (req.method === 'GET' && chatAsset && opts.chat !== false) {
      try {
        const body = await readFile(join(resolveChatDist(), chatAsset[1]!), 'utf8');
        const isMap = chatAsset[1]!.endsWith('.map');
        res.writeHead(200, { 'content-type': isMap ? 'application/json' : 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(body);
        return;
      } catch {
        return json(404, { error: 'not found' });
      }
    }

    // Authn: bearer token → principal. Authz: the route's required role.
    // ADR 0025: a configured principalStore resolves per request (a write
    // is live on the next request); the static map is the gateway-fronted
    // path. Neither configured → the control plane is open (dev default).
    //
    // ADR 0025 is explicit that principalStore is "additive, alongside
    // (not replacing) the existing static principals map" — a deployment
    // that configures both keeps the static map as a break-glass/bootstrap
    // path. That matters concretely: POST /admin/principals itself needs
    // an admin bearer token, so a principalStore that starts empty (a
    // fresh SQLite file, nothing seeded) has no way to ever authenticate
    // anyone unless a static token still works as a fallback here. Check
    // the store first (it's the live, revocable source of truth), then
    // fall back to the static map rather than short-circuiting on
    // whichever was configured.
    let principal: Principal | undefined;
    if (opts.principalStore !== undefined || principals !== undefined) {
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      let p: { id: string; roles: Iterable<string>; tenantId?: string } | undefined;
      if (bearer !== undefined) {
        p = opts.principalStore !== undefined ? await opts.principalStore.get(bearer) : undefined;
        if (p === undefined) p = principals?.[bearer];
      }
      if (p === undefined) return json(401, { error: 'unauthorized' });
      principal = { id: p.id, roles: expandRoles(p.roles), ...(p.tenantId !== undefined && { tenantId: p.tenantId }) };
      const required = requiredRole(req.method ?? '', url.pathname);
      if (required !== undefined && !principal.roles.has(required)) {
        return json(403, { error: 'forbidden', required });
      }
    }

    // ADR 0026: authenticated self-description — the caller's own identity
    // and effective roles, so a UI renders what this principal can see.
    // No auth configured → open dev mode, reported honestly.
    if (req.method === 'GET' && url.pathname === '/me') {
      return json(200, principal !== undefined
        ? { id: principal.id, roles: [...principal.roles], ...(principal.tenantId !== undefined && { tenantId: principal.tenantId }) }
        : { id: 'anonymous', roles: ['viewer', 'operator', 'approver', 'admin'], open: true });
    }

    if (req.method === 'GET' && url.pathname === '/runs') {
      // No tenant on the caller → unscoped (every run) — see ADR 0013.
      // ?traceId=<id> lists one delegation tree instead of every run.
      const traceIdFilter = url.searchParams.get('traceId');
      const list = await registry.list({
        limit: 200,
        ...(principal?.tenantId !== undefined && { tenantId: principal.tenantId }),
        ...(traceIdFilter !== null && { traceId: traceIdFilter }),
      });
      return json(200, list.map((r) => ({
        runId: r.runId, status: r.status, agentId: r.agentId, goal: r.goal,
        startedAt: r.startedAt, updatedAt: r.updatedAt,
        ...(r.host !== undefined && { host: r.host }),
        ...(r.traceId !== undefined && { traceId: r.traceId }),
        ...(r.specName !== undefined && { specName: r.specName }),
        ...(r.tenantId !== undefined && { tenantId: r.tenantId }),
      })));
    }

    const runMatch = /^\/runs\/([^/]+)(\/events|\/evidence)?$/.exec(url.pathname);
    if (req.method === 'GET' && runMatch) {
      // A run outside the caller's tenant is a 404, not a 403 — a
      // cross-tenant probe learns nothing about whether it exists. Only
      // pay for the extra registry read when tenant scoping is configured
      // at all; the untenanted default path is unaffected.
      if (principal?.tenantId !== undefined) {
        const owned = await registry.get(runMatch[1]!);
        if (owned && owned.tenantId !== principal.tenantId) return json(404, { error: 'unknown run' });
      }
      const rec = runs.get(runMatch[1]!);

      if (runMatch[2] === '/events') {
        // Resume a stream instead of re-replaying the whole journal on
        // every reconnect: ?since=<seq> skips events at or below it. This
        // filters at the response boundary — runner.events() itself still
        // replays from the start, same cost as today's no-`since` case —
        // but the client only pays network/render cost for what's new.
        const sinceParam = url.searchParams.get('since');
        const since = sinceParam !== null ? Number(sinceParam) : undefined;
        if (sinceParam !== null && (!Number.isFinite(since) || since! < 0)) {
          return json(400, { error: 'since must be a non-negative integer' });
        }
        if (rec) {
          // SSE: runner.events() replays the journal then live-tails;
          // the stream ends after the run's terminal event.
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          void (async () => {
            for await (const e of rec.runner.events()) {
              if (since === undefined || e.seq > since) res.write(`data: ${JSON.stringify(e)}\n\n`);
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
          for (const e of events) if (since === undefined || e.seq > since) res.write(`data: ${JSON.stringify(e)}\n\n`);
          res.end();
          return;
        }
        return json(404, { error: 'run not on this replica; configure journal for cross-replica reads' });
      }

      if (runMatch[2] === '/evidence') {
        // buildEvidence() correlates the whole journal (gate → action →
        // observation → verifier) — the same computation naro verify
        // does offline, exposed live so a client renders the evidence
        // tree instead of re-deriving it from raw events itself.
        const events = rec ? rec.runner.history()
          : opts.journal ? await opts.journal.history({ runId: runMatch[1]! })
            : undefined;
        if (events === undefined) return json(404, { error: 'run not on this replica; configure journal for cross-replica reads' });
        if (events.length === 0) return json(404, { error: 'unknown run' });
        return json(200, buildEvidence(events));
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

    // ADR 0022 — the Article 14 stop button: cancel one run without
    // restarting the server (which drain-cancels every run). The same
    // AbortController drain uses; `reason` is required and `by` is stamped
    // from the calling principal — both land on agent.cancelled.
    const cancelMatch = /^\/runs\/([^/]+)\/cancel$/.exec(url.pathname);
    if (req.method === 'POST' && cancelMatch) {
      let body: { reason?: string };
      try { body = JSON.parse(await readBody(req, maxBody)); }
      catch (e) {
        return json(e instanceof Error && e.message === 'too-large' ? 413 : 400,
          { error: e instanceof Error && e.message === 'too-large' ? 'body too large' : 'invalid JSON' });
      }
      if (typeof body.reason !== 'string' || body.reason.length === 0) {
        return json(400, { error: 'reason is required — a cancellation must say why' });
      }
      const rec = runs.get(cancelMatch[1]!);
      // 404, not 403, for a foreign tenant's run — a cross-tenant probe
      // learns nothing about whether the run exists (same rule as GET).
      if (!rec || rec.status !== 'running'
        || (principal?.tenantId !== undefined && rec.tenantId !== principal.tenantId)) {
        return json(404, { error: 'unknown run' });
      }
      rec.signal.abort({ reason: body.reason, ...(principal !== undefined && { by: principal.id }) });
      return json(202, { ok: true, runId: rec.id, status: 'cancelling' });
    }

    if (req.method === 'POST' && url.pathname === '/runs/cancel-all') {
      let body: { reason?: string };
      try { body = JSON.parse(await readBody(req, maxBody)); }
      catch (e) {
        return json(e instanceof Error && e.message === 'too-large' ? 413 : 400,
          { error: e instanceof Error && e.message === 'too-large' ? 'body too large' : 'invalid JSON' });
      }
      if (typeof body.reason !== 'string' || body.reason.length === 0) {
        return json(400, { error: 'reason is required — a fleet halt must say why' });
      }
      // A tenant-scoped admin halts only their tenant's runs.
      const targets = [...runs.values()].filter((r) => r.status === 'running'
        && (principal?.tenantId === undefined || r.tenantId === principal.tenantId));
      for (const r of targets) {
        r.signal.abort({ reason: body.reason, ...(principal !== undefined && { by: principal.id }) });
      }
      return json(202, { ok: true, cancelled: targets.length });
    }

    // ---- ADR 0024: admin surface for registry + retention decisions ----
    // These mutate registry/store state directly — operator decisions
    // ABOUT the gate's data, not actions a goal is requesting. The admin
    // role check at the HTTP layer is the entire authorization boundary.

    if (req.method === 'GET' && url.pathname === '/admin/tool-collisions') {
      if (!opts.toolRegistry) return json(501, { error: 'no tool registry configured' });
      return json(200, opts.toolRegistry.collisions());
    }
    if (req.method === 'POST' && url.pathname === '/admin/tool-collisions/resolve') {
      if (!opts.toolRegistry) return json(501, { error: 'no tool registry configured' });
      let body: { name?: string; sourceId?: string };
      try { body = JSON.parse(await readBody(req, maxBody)); }
      catch (e) {
        return json(e instanceof Error && e.message === 'too-large' ? 413 : 400,
          { error: e instanceof Error && e.message === 'too-large' ? 'body too large' : 'invalid JSON' });
      }
      if (!body.name || !body.sourceId) return json(400, { error: 'name and sourceId required — resolving means picking the winning source' });
      return opts.toolRegistry.resolve(body.name, body.sourceId)
        ? json(200, { ok: true, resolved: { name: body.name, sourceId: body.sourceId }, by: principal?.id })
        : json(404, { error: 'no pending collision for that name/sourceId pair' });
    }

    if (req.method === 'GET' && url.pathname === '/admin/tool-definitions/changed') {
      if (!opts.toolRegistry) return json(501, { error: 'no tool registry configured' });
      return json(200, opts.toolRegistry.changedDefinitions());
    }
    if (req.method === 'POST' && url.pathname === '/admin/tool-definitions/acknowledge') {
      if (!opts.toolRegistry) return json(501, { error: 'no tool registry configured' });
      let body: { name?: string; sourceId?: string };
      try { body = JSON.parse(await readBody(req, maxBody)); }
      catch (e) {
        return json(e instanceof Error && e.message === 'too-large' ? 413 : 400,
          { error: e instanceof Error && e.message === 'too-large' ? 'body too large' : 'invalid JSON' });
      }
      if (!body.name) return json(400, { error: 'name required' });
      return opts.toolRegistry.acknowledgeDefinition(body.name, body.sourceId)
        ? json(200, { ok: true, acknowledged: body.name, by: principal?.id })
        : json(404, { error: 'no pending definition change for that tool' });
    }

    const pruneMatch = /^\/admin\/runs\/([^/]+)\/prune$/.exec(url.pathname);
    if (req.method === 'POST' && pruneMatch) {
      const prune = opts.journal?.prune;
      if (prune === undefined) {
        return json(501, { error: "this deployment's event store is not prunable (ADR 0018 — needs a PrunableEventStore)" });
      }
      let body: { throughSeq?: number; policy?: string };
      try { body = JSON.parse(await readBody(req, maxBody)); }
      catch (e) {
        return json(e instanceof Error && e.message === 'too-large' ? 413 : 400,
          { error: e instanceof Error && e.message === 'too-large' ? 'body too large' : 'invalid JSON' });
      }
      if (!Number.isInteger(body.throughSeq) || body.throughSeq! < 0) {
        return json(400, { error: 'throughSeq must be a non-negative integer' });
      }
      try {
        const result = await prune(pruneMatch[1]!, body.throughSeq!, {
          ...(body.policy !== undefined && { policy: body.policy }),
          ...(principal !== undefined && { by: principal.id }),
          ...(opts.pruneSealKey !== undefined && { sealKey: opts.pruneSealKey }),
        });
        return json(200, { ok: true, ...result });
      } catch (e) {
        // planPrune's own validation (non-terminal run, bad cutoff,
        // nothing to anchor on) is a caller error, not a server fault.
        return json(400, { error: e instanceof Error ? e.message : 'prune refused' });
      }
    }

    // ---- ADR 0025: live principal administration ----

    if (req.method === 'GET' && url.pathname === '/admin/principals') {
      if (!opts.principalStore) return json(501, { error: 'no principal store configured — principals are a static map' });
      const list = await opts.principalStore.list();
      // tokenLast4 for display, never the raw token — it's a hash at rest
      // and shown once at issuance, nowhere else.
      return json(200, list.map((p) => ({
        id: p.id, roles: [...p.roles], tokenLast4: p.tokenLast4, createdAt: p.createdAt,
        ...(p.tenantId !== undefined && { tenantId: p.tenantId }),
      })));
    }
    if (req.method === 'POST' && url.pathname === '/admin/principals') {
      if (!opts.principalStore) return json(501, { error: 'no principal store configured — principals are a static map' });
      let body: { id?: string; roles?: string[]; tenantId?: string };
      try { body = JSON.parse(await readBody(req, maxBody)); }
      catch (e) {
        return json(e instanceof Error && e.message === 'too-large' ? 413 : 400,
          { error: e instanceof Error && e.message === 'too-large' ? 'body too large' : 'invalid JSON' });
      }
      if (!Array.isArray(body.roles) || body.roles.length === 0 || !body.roles.every((r) => typeof r === 'string')) {
        return json(400, { error: 'roles (non-empty string array) required' });
      }
      const token = generateToken();
      const principal_: Principal = {
        id: body.id ?? newId('principal'), roles: new Set(body.roles),
        ...(body.tenantId !== undefined && { tenantId: body.tenantId }),
      };
      await opts.principalStore.upsert(token, principal_);
      // Shown once — the store holds only the hash + last-4, so this
      // response is the only place the raw token ever exists.
      return json(201, {
        token, id: principal_.id, roles: [...principal_.roles],
        ...(principal_.tenantId !== undefined && { tenantId: principal_.tenantId }),
      });
    }
    const principalMatch = /^\/admin\/principals\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'DELETE' && principalMatch) {
      if (!opts.principalStore) return json(501, { error: 'no principal store configured — principals are a static map' });
      return await opts.principalStore.revokeById(principalMatch[1]!)
        ? json(200, { ok: true, revoked: principalMatch[1]!, by: principal?.id })
        : json(404, { error: 'unknown principal' });
    }

    if (req.method === 'POST' && url.pathname === '/goals') {
      if (draining) return json(503, { error: 'draining — not accepting new runs' });
      let body: { description?: string; successCriteria?: string[]; idempotencyKey?: string; template?: string };
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
      const rec: RunRecord = {
        id, runner: factory(goal, { ...(principal !== undefined && { principal }), ...(typeof body.template === 'string' && { template: body.template }) }),
        status: 'running', signal: new AbortController(),
        ...(principal?.tenantId !== undefined && { tenantId: principal.tenantId }),
      };
      runs.set(rec.id, rec);
      const startedAt = Date.now();
      let agentId = '';
      let traceId: string | undefined;
      let specName: string | undefined;
      // goal.started carries the agent's identity and the goal text —
      // index the run the moment its journal begins. Its own traceId is a
      // root run's own runId unless a caller passed one in (delegation —
      // see @naro/multiagent's delegationConstraints), so this always has one.
      rec.runner.on('goal.started', (e) => {
        agentId = e.agentId;
        traceId = e.traceId;
        void registry.upsert({
          runId: rec.id, agentId, status: 'running', goal: e.data.goal.description,
          startedAt, updatedAt: Date.now(), host: hostName,
          ...(principal?.tenantId !== undefined && { tenantId: principal.tenantId }),
          ...(traceId !== undefined && { traceId }),
          ...(specName !== undefined && { specName }),
        });
      });
      // agent.created fires first and carries the spec's declared name —
      // how a UI groups runs under the template that produced them.
      rec.runner.on('agent.created', (e) => {
        specName = e.data.name;
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
          ...(principal?.tenantId !== undefined && { tenantId: principal.tenantId }),
          ...(traceId !== undefined && { traceId }),
          ...(specName !== undefined && { specName }),
          ...(r.result !== undefined && { result: r.result }),
          ...(r.error !== undefined && { error: r.error }),
        });
      }).catch((e) => {
        rec.status = 'failed'; rec.error = e instanceof Error ? e.message : String(e);
        void registry.upsert({
          runId: rec.id, agentId, status: 'failed', goal: goal.description,
          startedAt, updatedAt: Date.now(), host: hostName, error: rec.error,
          ...(traceId !== undefined && { traceId }),
          ...(specName !== undefined && { specName }),
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
