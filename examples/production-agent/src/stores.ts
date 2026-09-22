import { mkdirSync } from 'node:fs';
import type { CheckpointStore, HumanBridge } from '@naro/runtime';
import { SqliteApprovalBridge } from '@naro/runtime';
import { SqliteCheckpointStore } from '@naro/runtime';
import { SqliteLeaseStore, type LeaseStore } from '@naro/runtime';
import { SqliteLimitStore, type LimitStore } from '@naro/policy';
import { pgPool, PgApprovalBridge, PgCheckpointStore, PgLeaseStore, PgLimitStore } from '@naro/adapter-pg';

/**
 * Durable stores for the production agent — SQLite for a single host,
 * Postgres when NARO_PG_URL is set (the same `naro serve --pg` precedence
 * this repo's own CLI uses, so an agent module and the control plane that
 * runs it agree on how to pick a durability tier).
 */
export interface Stores {
  readonly checkpoints: CheckpointStore;
  readonly lease: LeaseStore;
  readonly limits: LimitStore;
  readonly approvals: HumanBridge & {
    pending(): unknown[] | Promise<unknown[]>;
    respond(id: string, answer: { approved?: boolean; text?: string; note?: string }, by?: string): boolean | Promise<boolean>;
  };
}

export async function openStores(dataDir = process.env['NARO_DATA_DIR'] ?? '.naro'): Promise<Stores> {
  const pgUrl = process.env['NARO_PG_URL'];
  if (pgUrl !== undefined) {
    const pool = await pgPool(pgUrl);
    return {
      checkpoints: await PgCheckpointStore.create(pool),
      lease: await PgLeaseStore.create(pool),
      limits: await PgLimitStore.create(pool),
      approvals: await PgApprovalBridge.create(pool),
    };
  }

  mkdirSync(dataDir, { recursive: true });
  return {
    checkpoints: new SqliteCheckpointStore(`${dataDir}/checkpoints.db`),
    lease: new SqliteLeaseStore(`${dataDir}/leases.db`),
    limits: new SqliteLimitStore(`${dataDir}/limits.db`),
    approvals: new SqliteApprovalBridge(`${dataDir}/approvals.db`),
  };
}
