import { createObservation, type Action, type ExecContext, type Observation } from '@naro/core';
import type { Environment, EnvironmentState } from '@naro/environment';
import type { SqlDriver } from './driver.ts';

/**
 * A data agent's world: one database connection.
 *
 * Capabilities:
 *   sql.query  — parameterized SELECT/WITH only (reads)
 *   sql.exec   — parameterized INSERT/UPDATE/DELETE/DDL (writes — the
 *                capability policy should gate)
 *   sql.schema — table/column inventory
 *
 * Safety is layered: parameterized params only (no string interpolation
 * reaches SQL), read/write split by statement classification, row caps.
 * An agent that only needs to read simply never gets the sql.exec grant.
 */

const READ_RE = /^\s*(SELECT|WITH|EXPLAIN|PRAGMA)\b/i;

export interface DataEnvOptions {
  readonly driver: SqlDriver;
  /** Max rows returned per query. Default 500. */
  readonly maxRows?: number;
}

export class DataEnvironment implements Environment {
  readonly id: string;
  readonly capabilities = ['sql.query', 'sql.exec', 'sql.schema'];
  private readonly driver: SqlDriver;
  private readonly maxRows: number;

  constructor(opts: DataEnvOptions, id = 'db') {
    this.driver = opts.driver;
    this.maxRows = opts.maxRows ?? 500;
    this.id = id;
  }

  async state(): Promise<EnvironmentState> {
    const schema = await this.driver.schema();
    return { at: Date.now(), resources: { tables: schema } };
  }

  async execute(action: Action, _ctx: ExecContext): Promise<Observation> {
    const input = (action.input ?? {}) as { sql?: unknown; params?: unknown };
    try {
      switch (action.capability) {
        case 'sql.schema': {
          return this.obs(action, true, await this.driver.schema());
        }
        case 'sql.query': {
          const sql = String(input.sql ?? '');
          if (!READ_RE.test(sql)) {
            return this.obs(action, false, undefined,
              `sql.query only accepts SELECT/WITH/EXPLAIN/PRAGMA — got '${sql.slice(0, 40)}'. Writes need the sql.exec capability (and its grant).`);
          }
          const rows = await this.driver.query(sql, this.params(input));
          const truncated = rows.length > this.maxRows;
          return this.obs(action, true, {
            rows: rows.slice(0, this.maxRows),
            rowCount: Math.min(rows.length, this.maxRows),
            ...(truncated && { truncated: true, totalRows: rows.length }),
          });
        }
        case 'sql.exec': {
          const sql = String(input.sql ?? '');
          if (READ_RE.test(sql)) {
            return this.obs(action, false, undefined,
              'sql.exec is for writes — use sql.query for reads');
          }
          const r = await this.driver.exec(sql, this.params(input));
          return this.obs(action, true, r);
        }
        default:
          return this.obs(action, false, undefined,
            `environment '${this.id}' does not support capability '${action.capability}'`);
      }
    } catch (e) {
      return this.obs(action, false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  private params(input: { params?: unknown }): readonly unknown[] {
    return Array.isArray(input.params) ? input.params : [];
  }

  private obs(action: Action, success: boolean, output?: unknown, error?: string): Observation {
    return createObservation({
      actionId: action.id, source: `env://${this.id}`, kind: 'env-change',
      success,
      ...(output !== undefined && { output }),
      ...(error !== undefined && { error }),
    });
  }
}
