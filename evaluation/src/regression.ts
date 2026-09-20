import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { EvalReport, EvalResult } from './benchmark.ts';

/**
 * Benchmarks are only useful if you can compare runs. A report store
 * makes history durable; diffReports() turns "did it change?" into
 * "which cases regressed, and by how much."
 */

export interface StoredReport {
  readonly at: number;
  readonly label?: string;
  readonly report: EvalReport;
}

export interface ReportStore {
  save(report: EvalReport, label?: string): Promise<void>;
  /** All stored reports, oldest first. */
  list(): Promise<readonly StoredReport[]>;
}

/** JSONL report store — one line per benchmark run. */
export class JsonlReportStore implements ReportStore {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  async save(report: EvalReport, label?: string): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const entry: StoredReport = { at: Date.now(), ...(label !== undefined && { label }), report };
    await appendFile(this.file, JSON.stringify(entry) + '\n');
  }

  async list(): Promise<readonly StoredReport[]> {
    try {
      const text = await readFile(this.file, 'utf8');
      return text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as StoredReport);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
}

export interface CaseDiff {
  readonly caseId: string;
  readonly before: { ok: boolean; status: string };
  readonly after: { ok: boolean; status: string };
  /** True when a passing case now fails — the thing a release gate cares about. */
  readonly regressed: boolean;
  /** True when a failing case now passes. */
  readonly improved: boolean;
}

export interface ReportDiff {
  readonly cases: readonly CaseDiff[];
  readonly regressions: readonly CaseDiff[];
  readonly improvements: readonly CaseDiff[];
  /** Cases present in only one report. */
  readonly onlyInBaseline: readonly string[];
  readonly onlyInCurrent: readonly string[];
  readonly passRateDelta: number;
  readonly durationDeltaMs: number;
}

export function diffReports(baseline: EvalReport, current: EvalReport): ReportDiff {
  const before = new Map(baseline.results.map((r) => [r.caseId, r]));
  const after = new Map(current.results.map((r) => [r.caseId, r]));

  const cases: CaseDiff[] = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a) continue;
    cases.push({
      caseId: id,
      before: { ok: b.ok, status: b.status },
      after: { ok: a.ok, status: a.status },
      regressed: b.ok && !a.ok,
      improved: !b.ok && a.ok,
    });
  }
  return {
    cases,
    regressions: cases.filter((c) => c.regressed),
    improvements: cases.filter((c) => c.improved),
    onlyInBaseline: [...before.keys()].filter((id) => !after.has(id)),
    onlyInCurrent: [...after.keys()].filter((id) => !before.has(id)),
    passRateDelta: current.passRate - baseline.passRate,
    durationDeltaMs: current.totals.durationMs - baseline.totals.durationMs,
  };
}
