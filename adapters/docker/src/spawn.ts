import { spawn as nodeSpawn } from 'node:child_process';

export interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

/** Injected for offline tests — real work goes through `defaultSpawn`. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  opts: { readonly input: string; readonly timeoutMs: number },
) => Promise<SpawnResult>;

/**
 * `node:child_process.spawn`, not `exec` — args are never shell-interpolated,
 * so a value inside `action.input` can't break out into a second command.
 */
export const defaultSpawn: SpawnFn = (command, args, opts) => new Promise((resolve) => {
  const child = nodeSpawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, opts.timeoutMs);

  child.stdout.on('data', (c: Buffer) => { stdout += c; });
  child.stderr.on('data', (c: Buffer) => { stderr += c; });
  child.on('error', (e) => {
    clearTimeout(timer);
    resolve({ stdout, stderr: stderr || e.message, exitCode: null, timedOut });
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve({ stdout, stderr, exitCode: code, timedOut });
  });

  child.stdin.write(opts.input);
  child.stdin.end();
});
