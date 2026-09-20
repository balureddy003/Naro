import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { basename, resolve } from 'node:path';
import { AGENT_STATES, TRANSITIONS, type NaroEvent } from '@naro/core';
import { computeMetrics } from '@naro/observability';
import { BenchmarkRunner, diffReports, formatReport, JsonlReportStore, type EvalCase } from '@naro/evaluation';
import { SqliteApprovalBridge } from '@naro/runtime';
import { startAgentServer, type RunnerFactory } from './serve.ts';

export interface CliIO {
  out: (s: string) => void;
  err: (s: string) => void;
}

const HELP = `naro — universal agent foundation CLI

  naro run <agent.ts>      run an agent module (Node 26 native TS)
  naro bench <bench.ts>    run a benchmark module exporting EvalCase[]
                           [--save <store.jsonl>] [--label <name>]
                           [--baseline <store.jsonl>] — gate: exit 1 on regressions
  naro replay <file.jsonl> reprint + summarize a recorded event stream
  naro init <dir>          scaffold a new agent project [--reasoner react|direct]
  naro serve <module.ts>   expose an agent as a service [--port N] [--host h]
                             module exports createRunner(goal): AgentRunner
  naro approvals --db <db> list pending human-in-the-loop requests
  naro approve <id> --db <db> [--deny] [--note 'why']
  naro answer  <id> --db <db> --text 'response'
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
      return 0;
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
      const file = rest[0];
      if (!file) { io.err('usage: naro serve <module.ts> [--port N] [--host h]'); return 2; }
      const flag = (name: string) => rest[rest.indexOf(name) + 1];
      const port = flag('--port') ? Number(flag('--port')) : 8080;
      const host = flag('--host');
      const mod = await import(pathToFileURL(resolve(file)).href) as { createRunner?: RunnerFactory };
      if (typeof mod.createRunner !== 'function') {
        io.err(`${file} must export createRunner(goal): AgentRunner`);
        return 2;
      }
      const { url, close } = await startAgentServer(mod.createRunner, { port, ...(host !== undefined && { host }) });
      io.out(`agent serving at ${url} — POST /goals {description}`);
      // Serve until killed.
      process.on('SIGINT', () => { void close().then(() => process.exit(0)); });
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
