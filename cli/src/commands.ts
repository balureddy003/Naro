import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { AGENT_STATES, TRANSITIONS, type NaroEvent } from '@naro/core';
import { computeMetrics } from '@naro/observability';
import { BenchmarkRunner, diffReports, formatReport, JsonlReportStore, type EvalCase } from '@naro/evaluation';

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
  naro states              print the agent lifecycle transition table
`;

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

    case 'run': {
      const file = rest[0];
      if (!file) { io.err('usage: naro run <agent.ts>'); return 2; }
      return new Promise<number>((res) => {
        const child = spawn(process.execPath, [resolve(file)], { stdio: 'inherit' });
        child.on('exit', (code) => res(code ?? 1));
      });
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
