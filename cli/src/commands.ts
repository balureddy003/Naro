import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { basename, resolve } from 'node:path';
import { AGENT_STATES, TRANSITIONS, type NaroEvent } from '@naro/core';
import { buildEvidence, computeMetrics, formatEvidence, SqliteEventStore } from '@naro/observability';
import { BenchmarkRunner, diffReports, formatReport, JsonlReportStore, type EvalCase } from '@naro/evaluation';
import { SqliteApprovalBridge, SqliteRunRegistry } from '@naro/runtime';
// Statically imported but Postgres-inert until a `--pg`/`--registry-pg`/
// `--journal-pg` flag actually calls pgPool(): it dynamically imports the
// optional 'pg' peer dependency only then, so `naro serve` without Postgres
// flags never requires 'pg' to be installed.
import { pgPool, PgApprovalBridge, PgEventStore, PgRunRegistry } from '@naro/adapter-pg';
import { startAgentServer, type RunnerFactory, type ServeOptions } from './serve.ts';
import { SqlitePrincipalStore } from './principals.ts';

export interface CliIO {
  out: (s: string) => void;
  err: (s: string) => void;
}

/**
 * Which durable store backs one `naro serve` port (registry or journal):
 * an explicit SQLite path always wins over Postgres for that same store —
 * single-host flags stay authoritative when given — otherwise a per-store
 * Pg URL wins over the shared one. Pure and side-effect free so the
 * precedence rules are unit-testable without a real Postgres connection.
 */
export function resolveServeStore(opts: {
  readonly sqlitePath: string | undefined;
  readonly pgUrlFlag: string | undefined;
  readonly sharedPgUrl: string | undefined;
}): { readonly kind: 'sqlite'; readonly path: string } | { readonly kind: 'pg'; readonly url: string } | undefined {
  if (opts.sqlitePath !== undefined) return { kind: 'sqlite', path: opts.sqlitePath };
  const url = opts.pgUrlFlag ?? opts.sharedPgUrl;
  return url !== undefined ? { kind: 'pg', url } : undefined;
}

const HELP = `naro — universal agent foundation CLI

  naro run <agent.ts>      run an agent module (Node 24+ native TS)
  naro bench <bench.ts>    run a benchmark module exporting EvalCase[]
                           [--save <store.jsonl>] [--label <name>]
                           [--baseline <store.jsonl>] — gate: exit 1 on regressions
  naro replay <file.jsonl> reprint + summarize a recorded event stream
  naro verify <file.jsonl> verify the hash chain + seal + print the evidence record [--pubkey key.pem]
                           [--json] — machine-readable EvidenceRecord
                           exit 0: chain intact · 1: broken/unchained · 2: usage
  naro init <dir>          scaffold a new agent project [--reasoner react|direct]
  naro serve <module.ts>   expose an agent as a service [--port N] [--host h]
                             [--token t | NARO_SERVE_TOKEN] — bearer gate on
                             all non-probe endpoints
                             [--principals <file.json>] — token→{id,roles,tenantId?}
                               map; roles: viewer, operator, approver;
                               tenantId scopes GET /runs visibility (ADR 0013)
                             [--principals-store <file.db>] — live identity store
                               (ADR 0025): /admin/principals issues + revokes
                               without restart; checked before --principals,
                               not instead of it — keep --principals as a
                               bootstrap admin token, or a fresh store has
                               no one able to authenticate at all
                             [--no-console] — disable GET /console (on by default)
                             [--no-chat] — disable GET /chat (on by default)
                             [--registry <file.db>] — durable run index (SQLite)
                             [--journal <file.db>]  — shared event store for
                               cross-replica GET /runs/:id/events (SQLite)
                             [--approvals <file.db>] — expose /approvals
                             [--pg <url> | NARO_PG_URL] — Postgres-backed
                               registry + journal + approvals for N-replica
                               naro serve; overridden per-store by
                               --registry-pg/--journal-pg/--approvals-pg;
                               requires the optional 'pg' package
                             [--registry-pg <url>] [--journal-pg <url>] [--approvals-pg <url>]
                             module exports createRunner(goal): AgentRunner
  naro approvals --db <db> list pending human-in-the-loop requests
  naro approve <id> --db <db> [--deny] [--note 'why']
  naro answer  <id> --db <db> --text 'response'
  naro prune <store.db>    attest-and-prune a run's journal (ADR 0018)
                             --run <id> --before <seq|ISO-date>
                             [--reason <policy citation>] [--seal-key key.pem]
  naro states              print the agent lifecycle transition table
`;

const SCAFFOLD_MAIN = `import { createAgentSpec, createGoal, allowAllPolicy } from '@naro/core';
import { AgentRunner, CompositeExecutor } from '@naro/runtime';
import { MockModel } from '@naro/model';
import { ReActReasoner } from '@naro/reasoning';
import { InMemoryEnvironment } from '@naro/environment';
import { createToolPolicy, ToolExecutor, ToolRegistry } from '@naro/tools';
import { allOf } from '@naro/policy';

// A working agent in ~30 lines: goal → reasoner → policy → executor.
// Swap MockModel for OpenAiCompatibleProvider/AnthropicModel/GeminiModel
// to go live — nothing else changes.
const env = new InMemoryEnvironment('local');
const registry = new ToolRegistry();
const executor = new CompositeExecutor({
  'tool://': new ToolExecutor(registry),
  'env://': env,
});

const runner = new AgentRunner({
  spec: createAgentSpec({ name: 'my-agent', goal: createGoal({ description: process.argv[2] ?? 'say hello' }) }),
  reasoner: new ReActReasoner(new MockModel()),
  executor,
  // REQUIRED — policy is the gate. allowAllPolicy is fine for dev;
  // compose real engines for anything that touches the world.
  policy: allOf(createToolPolicy(registry)),
});
runner.on('*', (e) => console.log(\`[\${e.seq}] \${e.type}\`));
const r = await runner.run();
console.log(\`→ \${r.status}:\`, r.result ?? r.error ?? '');
`;

const SCAFFOLD_PKG = (name: string) => JSON.stringify({
  name, version: '0.1.0', private: true, type: 'module',
  scripts: { start: 'node src/index.ts' },
  dependencies: {
    '@naro/core': '*', '@naro/runtime': '*', '@naro/model': '*',
    '@naro/reasoning': '*', '@naro/environment': '*', '@naro/tools': '*',
    '@naro/policy': '*',
  },
}, null, 2) + '\n';

/** Parse a JSONL audit stream back into events. */
export async function loadEvents(file: string): Promise<NaroEvent[]> {
  const text = await readFile(file, 'utf8');
  return text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as NaroEvent);
}

export async function main(argv: readonly string[], io: CliIO): Promise<number> {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case 'states': {
      io.out('Agent lifecycle — legal transitions:\n');
      for (const s of AGENT_STATES) {
        const tos = TRANSITIONS[s];
        io.out(`  ${s.padEnd(22)} → ${tos.length ? tos.join(', ') : '(terminal)'}`);
      }
      return 0;
    }

    case 'replay': {
      const file = rest[0];
      if (!file) { io.err('usage: naro replay <file.jsonl>'); return 2; }
      const events = await loadEvents(file);
      for (const e of events) io.out(`[${e.seq}] ${e.agentId} ${e.type}`);
      const m = computeMetrics(events);
      io.out(`\n— metrics —`);
      io.out(`  events=${m.totalEvents} iterations=${m.iterations} actions=${m.actionsRequested} denied=${m.actionsDenied} replans=${m.replans} duration=${m.durationMs}ms`);
      const chain = buildEvidence(events).chain;
      io.out(`  chain=${chain.ok ? `ok head=${chain.head?.slice(0, 12)}…` : `BROKEN ${chain.reason}`}`);
      return 0;
    }

    case 'verify': {
      const file = rest[0];
      if (!file) { io.err('usage: naro verify <file.jsonl> [--json] [--pubkey key.pem]'); return 2; }
      const pkIdx = rest.indexOf('--pubkey');
      const pubkeyFile = pkIdx >= 0 ? rest[pkIdx + 1] : undefined;
      const expectedKey = pubkeyFile !== undefined
        ? (await readFile(resolve(pubkeyFile), 'utf8')).trim()
        : undefined;
      const record = buildEvidence(await loadEvents(file));
      let sealOk = true;
      // --pubkey pins the signing key: the embedded key must match exactly.
      if (expectedKey !== undefined && record.chain.sealed?.ok === true) {
        sealOk = record.chain.sealed.publicKey?.trim() === expectedKey;
        if (!sealOk) io.err('seal public key does not match --pubkey');
      }
      if (expectedKey !== undefined && record.chain.sealed === undefined) {
        io.err('journal carries no seal — --pubkey has nothing to check');
        sealOk = false;
      }
      if (rest.includes('--json')) io.out(JSON.stringify(record, null, 2));
      else io.out(formatEvidence(record));
      return record.chain.ok && sealOk ? 0 : 1;
    }

    case 'prune': {
      const file = rest[0];
      const flag = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
      const runId = flag('--run');
      const before = flag('--before');
      const reason = flag('--reason');
      const sealKeyFile = flag('--seal-key');
      if (!file || !runId || !before) {
        io.err('usage: naro prune <store.db> --run <id> --before <seq|ISO-date> [--reason <policy>] [--seal-key key.pem]');
        return 2;
      }
      const store = new SqliteEventStore(resolve(file));
      try {
        let throughSeq = /^\d+$/.test(before) ? Number(before) : undefined;
        if (throughSeq === undefined) {
          const cutoff = Date.parse(before);
          if (Number.isNaN(cutoff)) { io.err('--before must be a seq number or ISO date'); return 2; }
          const lastBefore = [...store.history({ runId })].reverse().find((e) => e.at <= cutoff);
          if (!lastBefore) { io.err(`no events at or before ${before} for run ${runId}`); return 1; }
          throughSeq = lastBefore.seq;
        }
        const sealKey = sealKeyFile !== undefined ? await readFile(resolve(sealKeyFile), 'utf8') : undefined;
        const res = await store.prune(runId, throughSeq, {
          ...(reason !== undefined && { policy: reason }),
          ...(sealKey !== undefined && { sealKey }),
        });
        io.out(`pruned ${res.pruned} event(s) through seq ${throughSeq} — anchor ${res.anchorHash.slice(0, 12)}…`);
        io.out('the journal now opens with a disclosed journal.retention.pruned marker; `naro verify` reports it.');
        return 0;
      } catch (e) {
        io.err(e instanceof Error ? e.message : String(e));
        return 1;
      } finally {
        store.close();
      }
    }

    case 'init': {
      const dir = rest[0];
      if (!dir) { io.err('usage: naro init <dir>'); return 2; }
      const abs = resolve(dir);
      if (existsSync(abs) && (await readFile(abs).catch(() => undefined)) === undefined && existsSync(resolve(abs, 'package.json'))) {
        io.err(`${dir} already contains a package.json`); return 2;
      }
      await mkdir(resolve(abs, 'src'), { recursive: true });
      const name = basename(abs).replace(/[^a-z0-9-_]/gi, '-').toLowerCase() || 'naro-agent';
      await writeFile(resolve(abs, 'package.json'), SCAFFOLD_PKG(name));
      await writeFile(resolve(abs, 'src/index.ts'), SCAFFOLD_MAIN);
      io.out(`created ${dir}/ — a working agent scaffold`);
      io.out(`  cd ${dir} && npm install && npm start`);
      io.out('  then swap MockModel for a real provider adapter to go live.');
      return 0;
    }

    case 'run': {
      const file = rest[0];
      if (!file) { io.err('usage: naro run <agent.ts>'); return 2; }
      return new Promise<number>((res) => {
        const child = spawn(process.execPath, [resolve(file)], { stdio: 'inherit' });
        child.on('exit', (code) => res(code ?? 1));
      });
    }

    case 'serve': {
      // Flags first — splicing them out leaves positional args clean, so
      // `naro serve mod.ts --port 0` and `naro serve --port 0 mod.ts` both work.
      const args = [...rest];
      const flag = (name: string) => {
        const i = args.indexOf(name);
        return i >= 0 ? args.splice(i, 2)[1] : undefined;
      };
      const portArg = flag('--port');
      const port = portArg !== undefined ? Number(portArg) : 8080;
      const host = flag('--host');
      const token = flag('--token') ?? process.env['NARO_SERVE_TOKEN'];
      const principalsPath = flag('--principals');
      let principals: Record<string, { id: string; roles: readonly string[]; tenantId?: string }> | undefined;
      if (principalsPath !== undefined) {
        try {
          const parsed: unknown = JSON.parse(await readFile(resolve(principalsPath), 'utf8'));
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('expected a JSON object');
          for (const [tok, p] of Object.entries(parsed)) {
            const bad = typeof p !== 'object' || p === null
              || typeof (p as { id?: unknown }).id !== 'string'
              || !Array.isArray((p as { roles?: unknown }).roles)
              // tenantId (ADR 0013) is optional but must be a string when present.
              || ('tenantId' in p && typeof (p as { tenantId?: unknown }).tenantId !== 'string');
            if (bad) throw new Error(`entry for token '${tok}' must be {id: string, roles: string[], tenantId?: string}`);
          }
          principals = parsed as typeof principals;
        } catch (e) {
          io.err(`--principals: cannot read ${principalsPath}: ${e instanceof Error ? e.message : String(e)}`);
          return 2;
        }
      }
      const noConsole = args.includes('--no-console');
      if (noConsole) args.splice(args.indexOf('--no-console'), 1);
      const noChat = args.includes('--no-chat');
      if (noChat) args.splice(args.indexOf('--no-chat'), 1);
      const registryPath = flag('--registry');
      const journalPath = flag('--journal');
      const approvalsPath = flag('--approvals');
      // ADR 0025: --principals-store <file.db> adds a live
      // SqlitePrincipalStore alongside --principals (not instead of it —
      // see serve.ts's auth check) — writes via /admin/principals are
      // live on the next request, no restart.
      const principalsStorePath = flag('--principals-store');
      // A shared --pg/NARO_PG_URL backs all three stores; --registry-pg/
      // --journal-pg/--approvals-pg override it per-store; see
      // resolveServeStore() for the precedence.
      const sharedPgUrl = flag('--pg') ?? process.env['NARO_PG_URL'];
      const registrySource = resolveServeStore({ sqlitePath: registryPath, pgUrlFlag: flag('--registry-pg'), sharedPgUrl });
      const journalSource = resolveServeStore({ sqlitePath: journalPath, pgUrlFlag: flag('--journal-pg'), sharedPgUrl });
      const approvalsSource = resolveServeStore({ sqlitePath: approvalsPath, pgUrlFlag: flag('--approvals-pg'), sharedPgUrl });

      let registry: ServeOptions['registry'];
      let journal: ServeOptions['journal'];
      let approvals: ServeOptions['approvals'];
      try {
        if (registrySource?.kind === 'sqlite') registry = new SqliteRunRegistry(resolve(registrySource.path));
        else if (registrySource?.kind === 'pg') registry = await PgRunRegistry.create(await pgPool(registrySource.url));
        if (journalSource?.kind === 'sqlite') journal = new SqliteEventStore(resolve(journalSource.path));
        else if (journalSource?.kind === 'pg') journal = await PgEventStore.create(await pgPool(journalSource.url));
        if (approvalsSource?.kind === 'sqlite') approvals = new SqliteApprovalBridge(resolve(approvalsSource.path));
        else if (approvalsSource?.kind === 'pg') approvals = await PgApprovalBridge.create(await pgPool(approvalsSource.url));
      } catch (e) {
        const notInstalled = e instanceof Error && 'code' in e && e.code === 'ERR_MODULE_NOT_FOUND';
        io.err(notInstalled
          ? `Postgres registry/journal/approvals: the optional 'pg' package is not installed — run 'npm install pg'`
          : `Postgres registry/journal/approvals: ${e instanceof Error ? e.message : String(e)}`);
        return 2;
      }

      // A module's own createRunner() often constructs its own approvals
      // bridge (it has no other way to reach the one RunnerFactory's
      // signature doesn't pass through) — examples/chat-demo does exactly
      // this, reading NARO_APPROVALS_DB. Left unset, that falls back to a
      // hardcoded default path that silently diverges from whatever
      // --approvals actually pointed at: the server answers GET /approvals
      // from one SQLite file while the running agent's approval-wait reads
      // from another, so a pending approval is real (visible in the run's
      // own event journal) but never shows up anywhere a human can answer
      // it. Setting the env var here from the same resolved, absolute path
      // the server's own SqliteApprovalBridge uses makes --approvals the
      // single source of truth instead of a footgun two independently-
      // configured paths have to agree on by coincidence.
      if (approvalsSource?.kind === 'sqlite') process.env['NARO_APPROVALS_DB'] = resolve(approvalsSource.path);

      const file = args.find((a) => !a.startsWith('-'));
      if (!file) { io.err('usage: naro serve <module.ts> [--port N] [--host h]'); return 2; }
      const mod = await import(pathToFileURL(resolve(file)).href) as { createRunner?: RunnerFactory; chatTemplates?: ServeOptions['chatTemplates'] };
      if (typeof mod.createRunner !== 'function') {
        io.err(`${file} must export createRunner(goal): AgentRunner`);
        return 2;
      }
      const { url, close } = await startAgentServer(mod.createRunner, {
        port,
        ...(host !== undefined && { host }),
        ...(token !== undefined && { token }),
        ...(principals !== undefined && { principals }),
        ...(noConsole && { console: false }),
        ...(noChat && { chat: false }),
        ...(principalsStorePath !== undefined && { principalStore: new SqlitePrincipalStore(resolve(principalsStorePath)) }),
        ...(mod.chatTemplates !== undefined && { chatTemplates: mod.chatTemplates }),
        ...(registry !== undefined && { registry }),
        ...(journal !== undefined && { journal }),
        ...(approvals !== undefined && { approvals }),
      });
      io.out(`agent serving at ${url} — POST /goals {description}`);
      // Serve until killed. SIGTERM (k8s/compose) and SIGINT both drain:
      // readiness flips, in-flight runs get agent.cancelled, then close.
      for (const sig of ['SIGINT', 'SIGTERM'] as const) {
        process.on(sig, () => { void close().then(() => process.exit(0)); });
      }
      return new Promise<number>(() => {});
    }

    case 'approvals': {
      const db = rest[rest.indexOf('--db') + 1];
      if (!db) { io.err('usage: naro approvals --db <file.db>'); return 2; }
      const bridge = new SqliteApprovalBridge(resolve(db));
      const rows = bridge.pending();
      if (!rows.length) { io.out('no pending requests'); }
      for (const r of rows) {
        io.out(`${r.id}  ${r.kind}  ${new Date(r.createdAt).toISOString()}  ${r.question}`);
      }
      bridge.close();
      return 0;
    }

    case 'approve':
    case 'answer': {
      const id = rest[0];
      const db = rest[rest.indexOf('--db') + 1];
      if (!id || !db) { io.err(`usage: naro ${cmd} <id> --db <file.db> ${cmd === 'approve' ? '[--deny] [--note n]' : '--text t'}`); return 2; }
      const bridge = new SqliteApprovalBridge(resolve(db));
      const flag = (name: string) => rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined;
      const done = cmd === 'approve'
        ? bridge.respond(id, { approved: !rest.includes('--deny'), ...(flag('--note') !== undefined && { note: flag('--note') }) })
        : bridge.respond(id, { text: flag('--text') });
      io.out(done ? `${cmd}: ${id} answered` : `${cmd}: no pending request '${id}'`);
      bridge.close();
      return done ? 0 : 1;
    }

    case 'bench': {
      const file = rest[0];
      if (!file) { io.err('usage: naro bench <bench.ts> [--save f] [--label l] [--baseline f]'); return 2; }
      const flag = (name: string) => rest[rest.indexOf(name) + 1];
      const mod = await import(pathToFileURL(resolve(file)).href) as {
        cases?: EvalCase[]; default?: EvalCase[];
      };
      const cases = mod.cases ?? mod.default;
      if (!cases?.length) { io.err(`${file} must export EvalCase[] (named 'cases' or default)`); return 2; }
      const report = await new BenchmarkRunner().run(cases);
      io.out(formatReport(report));

      const savePath = rest.includes('--save') ? flag('--save') : undefined;
      if (savePath) {
        const label = rest.includes('--label') ? flag('--label') : undefined;
        await new JsonlReportStore(resolve(savePath)).save(report, label);
        io.out(`saved report to ${savePath}`);
      }

      const basePath = rest.includes('--baseline') ? flag('--baseline') : undefined;
      if (basePath) {
        const stored = await new JsonlReportStore(resolve(basePath)).list();
        const baseline = stored.at(-1)?.report;
        if (!baseline) { io.err(`no reports in ${basePath} to diff against`); return 2; }
        const diff = diffReports(baseline, report);
        io.out(`baseline diff: ${diff.regressions.length} regressions, ` +
          `${diff.improvements.length} improvements, ${diff.onlyInBaseline.length} removed, ` +
          `pass-rate Δ ${(diff.passRateDelta * 100).toFixed(1)}%`);
        for (const r of diff.regressions) io.out(`  REGRESSED ${r.caseId}: ${r.before.status} → ${r.after.status}`);
        for (const c of diff.onlyInBaseline) io.out(`  REMOVED   ${c} — was in the baseline; deleting a case is not fixing it`);
        for (const r of diff.improvements) io.out(`  improved  ${r.caseId}: ${r.before.status} → ${r.after.status}`);
        // The release gate: a passing case that now fails, OR a baseline
        // case that vanished from the run entirely — both are regressions.
        if (diff.regressions.length || diff.onlyInBaseline.length) return 1;
      }
      return report.failed === 0 ? 0 : 1;
    }

    case undefined:
    case 'help':
    case '--help':
      io.out(HELP);
      return 0;

    default:
      io.err(`unknown command '${cmd}'\n\n${HELP}`);
      return 2;
  }
}
