import {
  createObservation,
  type Action,
  type ExecContext,
  type Observation,
} from '@naro/core';
import type { Environment, EnvironmentState } from './environment.ts';

/**
 * The simplest honest environment: a key-value world.
 *
 * It exists to prove the abstraction — every capability is explicit,
 * every action returns an observation, and every mutation is recorded
 * in a change log you can inspect in tests. Coding/research/browser
 * environments are this same shape, with bigger state.
 *
 * Capabilities (matched against `action.capability`):
 *   env.get    — read the value at `env://<id>/<key>`
 *   env.set    — write `action.input` to that key
 *   env.delete — remove that key
 *   env.list   — list keys (target ignored)
 */
export class InMemoryEnvironment implements Environment {
  readonly id: string;
  readonly capabilities = ['env.get', 'env.set', 'env.delete', 'env.list'];
  private readonly store = new Map<string, unknown>();
  private readonly changeLog: string[] = [];

  constructor(id = 'local', initial?: Record<string, unknown>) {
    this.id = id;
    for (const [k, v] of Object.entries(initial ?? {})) this.store.set(k, v);
  }

  state(): EnvironmentState {
    return { at: Date.now(), resources: Object.fromEntries(this.store) };
  }

  /** What changed, in order — the environment's own audit trail. */
  changes(): readonly string[] {
    return this.changeLog;
  }

  execute(action: Action, _ctx: ExecContext): Promise<Observation> {
    const key = action.target.startsWith('env://')
      ? action.target.slice('env://'.length).split('/').at(-1)!
      : action.target;

    switch (action.capability) {
      case 'env.get': {
        const found = this.store.has(key);
        return Promise.resolve(this.obs(action, found,
          found ? this.store.get(key) : undefined,
          found ? undefined : `key '${key}' not found`));
      }
      case 'env.set': {
        this.store.set(key, action.input);
        this.changeLog.push(`set ${key}`);
        return Promise.resolve(this.obs(action, true, { key, value: action.input }));
      }
      case 'env.delete': {
        const existed = this.store.delete(key);
        if (existed) this.changeLog.push(`delete ${key}`);
        return Promise.resolve(this.obs(action, existed, { key, deleted: existed },
          existed ? undefined : `key '${key}' not found`));
      }
      case 'env.list': {
        return Promise.resolve(this.obs(action, true, [...this.store.keys()]));
      }
      default:
        return Promise.resolve(this.obs(action, false, undefined,
          `environment '${this.id}' does not support capability '${action.capability}'`));
    }
  }

  private obs(action: Action, success: boolean, output?: unknown, error?: string): Observation {
    return createObservation({
      actionId: action.id,
      source: `env://${this.id}`,
      kind: 'env-change',
      success,
      ...(output !== undefined && { output }),
      ...(error !== undefined && { error }),
    });
  }
}
