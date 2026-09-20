import { parentPort, workerData } from 'node:worker_threads';
import type { Action, ExecContext } from '@naro/core';

/**
 * The in-worker half of SandboxedExecutor. Loads the tool module inside
 * the worker's own heap, runs ONE action, posts the observation, exits.
 *
 * Contract for the module named by workerData.module:
 *   export function createExecutor(): ActionExecutor
 */

const { module: moduleSpecifier } = workerData as { module: string };

const mod = (await import(moduleSpecifier)) as {
  createExecutor(): { execute(action: Action, ctx: ExecContext): Promise<unknown> };
};
const executor = mod.createExecutor();

parentPort!.on('message', async (msg: { action: Action; ctx: ExecContext }) => {
  try {
    const observation = await executor.execute(msg.action, msg.ctx);
    parentPort!.postMessage({ ok: true, observation });
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
