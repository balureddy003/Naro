import { createServer } from 'node:http';
import { createObservation, type Action, type ExecContext, type Observation } from '@naro/core';
import type { Environment, EnvironmentState } from '@naro/environment';
import { spawn } from 'node:child_process';

/**
 * A DevOps agent's world: a runbook registry, not a shell.
 *
 * The coding profile gives an agent arbitrary shell — wrong for prod.
 * Operators declare named tasks as argv templates; the agent invokes by
 * name with validated params. There is no way to run an undeclared
 * command — that's the point.
 *
 * Capabilities:
 *   runbook.list — declared task inventory (read)
 *   runbook.run  — execute a declared task (write; policy should gate)
 *   probe.http   — GET a URL, return {status, ok, latencyMs} (read)
 */

export interface RunbookTask {
  readonly name: string;
  readonly description: string;
  /** argv with {param} placeholders — spawned WITHOUT a shell, so no injection. */
  readonly argv: readonly string[];
  /** param → regex the value must match. Default: safe token. */
  readonly params?: Readonly<Record<string, string>>;
  readonly sideEffects: 'read' | 'write' | 'destructive';
}

const SAFE_VALUE = /^[\w.:/=+-]+$/;

export interface DevOpsEnvOptions {
  readonly tasks: readonly RunbookTask[];
  /** Hosts probe.http may contact. Empty = probes denied. */
  readonly probeAllowlist?: readonly string[];
  readonly commandTimeoutMs?: number;
}

export class DevOpsEnvironment implements Environment {
  readonly id: string;
  readonly capabilities = ['runbook.list', 'runbook.run', 'probe.http'];
  private readonly tasks = new Map<string, RunbookTask>();
  private readonly probeAllowlist: readonly string[];
  private readonly timeoutMs: number;

  constructor(opts: DevOpsEnvOptions, id = 'ops') {
    for (const t of opts.tasks) this.tasks.set(t.name, t);
    this.probeAllowlist = opts.probeAllowlist ?? [];
    this.timeoutMs = opts.commandTimeoutMs ?? 30_000;
    this.id = id;
  }

  state(): EnvironmentState {
    return { at: Date.now(), resources: { tasks: [...this.tasks.keys()] } };
  }

  async execute(action: Action, _ctx: ExecContext): Promise<Observation> {
    const input = (action.input ?? {}) as Record<string, unknown>;
    switch (action.capability) {
      case 'runbook.list':
        return this.obs(action, true, [...this.tasks.values()].map((t) => ({
          name: t.name, description: t.description, sideEffects: t.sideEffects,
          params: Object.keys(t.params ?? {}),
        })));
      case 'runbook.run': {
        const task = this.tasks.get(String(input.name ?? ''));
        if (!task) return this.obs(action, false, undefined, `no runbook task '${input.name}' — call runbook.list`);
        const argv = this.render(task, (input.params ?? {}) as Record<string, unknown>);
        if (typeof argv === 'string') return this.obs(action, false, undefined, argv);
        const r = await this.spawn(argv);
        return this.obs(action, r.exitCode === 0, r, r.exitCode === 0 ? undefined : `exit ${r.exitCode}`);
      }
      case 'probe.http': {
        const url = String(input.url ?? '');
        let host: string;
        try { host = new URL(url).host; } catch { return this.obs(action, false, undefined, 'bad url'); }
        if (!this.probeAllowlist.includes(host)) {
          return this.obs(action, false, undefined, `host '${host}' not in probe allowlist`);
        }
        const t0 = Date.now();
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(input.timeoutMs ? Number(input.timeoutMs) : 5_000) });
          return this.obs(action, true, { status: res.status, ok: res.ok, latencyMs: Date.now() - t0 });
        } catch (e) {
          return this.obs(action, true, { status: 0, ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
        }
      }
      default:
        return this.obs(action, false, undefined, `environment '${this.id}' does not support capability '${action.capability}'`);
    }
  }

  /** Substitute {param} in argv tokens after validating each value's pattern. */
  private render(task: RunbookTask, params: Record<string, unknown>): string[] | string {
    const rules = task.params ?? {};
    for (const [k, v] of Object.entries(params)) {
      const re = new RegExp(rules[k] ?? SAFE_VALUE.source);
      if (!re.test(String(v))) return `param '${k}' failed pattern ${re} — refusing to interpolate`;
    }
    return task.argv.map((tok) =>
      tok.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)));
  }

  private spawn(argv: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((res) => {
      const child = spawn(argv[0]!, argv.slice(1), { timeout: this.timeoutMs });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d; });
      child.stderr.on('data', (d: Buffer) => { stderr += d; });
      child.on('error', (e) => res({ stdout, stderr: e.message, exitCode: 127 }));
      child.on('close', (code) => res({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 }));
    });
  }

  private obs(action: Action, success: boolean, output?: unknown, error?: string): Observation {
    return createObservation({
      actionId: action.id, source: `env://${this.id}`, kind: 'env-change',
      success, ...(output !== undefined && { output }), ...(error !== undefined && { error }),
    });
  }
}

/** Local probe server for tests/demos. */
export function probeServer(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((res) => {
    const s = createServer((_, r) => { r.writeHead(200).end('ok'); });
    s.listen(port, '127.0.0.1', () => {
      const a = s.address();
      const p = typeof a === 'object' && a ? a.port : port;
      res({ url: `http://127.0.0.1:${p}`, close: () => new Promise<void>((c) => s.close(() => c())) });
    });
  });
}
