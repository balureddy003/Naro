import {
  createObservation,
  type Action,
  type ActionExecutor,
  type ExecContext,
  type Observation,
} from '@naro/core';

/**
 * Horizontal scale for stateful executors: route an action to one of N
 * executor instances by a stable shard key.
 *
 * Default key is `action.target` — `env://tenant-acme/db` always lands on
 * the same shard, so per-tenant state (a browser session, a workspace, a
 * device connection) stays put. Same key → same shard is the contract;
 * which shard is an implementation detail (FNV-1a over the key).
 */
export class ShardedExecutor implements ActionExecutor {
  private readonly shards: readonly ActionExecutor[];
  private readonly keyOf: (action: Action) => string;

  constructor(opts: {
    readonly shards: readonly ActionExecutor[];
    /** Extract the shard key — default: the action target. */
    readonly keyOf?: (action: Action) => string;
  }) {
    if (opts.shards.length === 0) throw new Error('ShardedExecutor needs at least one shard');
    this.shards = opts.shards;
    this.keyOf = opts.keyOf ?? ((a) => a.target);
  }

  execute(action: Action, ctx: ExecContext): Promise<Observation> {
    const shard = this.shards[fnv1a(this.keyOf(action)) % this.shards.length]!;
    return shard.execute(action, ctx);
  }
}

/** Route by explicit shard → named executor, for non-hash layouts. */
export function routedBy(
  pick: (action: Action) => ActionExecutor | undefined,
): ActionExecutor {
  return {
    execute: (action, ctx) => {
      const ex = pick(action);
      if (!ex) {
        return Promise.resolve(createObservation({
          actionId: action.id, source: 'sharding', kind: 'error',
          success: false, error: `no shard for target '${action.target}'`,
        }));
      }
      return ex.execute(action, ctx);
    },
  };
}

/** FNV-1a 32-bit — stable across processes, no deps. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
