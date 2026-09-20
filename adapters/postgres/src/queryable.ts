/**
 * The one thing every Postgres store needs: `query(text, params) → rows`.
 * A `pg.Pool`, `pg.Client`, or `pg.PoolClient` all satisfy this — stores
 * never see the driver, so tests can substitute any queryable.
 */
export interface PgQueryable {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

/** Create a pg.Pool — dynamic import so this package loads without `pg` installed. */
export async function pgPool(connectionString: string): Promise<PgQueryable & { end(): Promise<void> }> {
  // Structural: `pg` is an optional peer — the module may not exist until
  // the consumer installs it, and we only need two methods off Pool.
  const mod = await import('pg' as string) as {
    Pool: new (opts: { connectionString: string }) => {
      query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
      end(): Promise<void>;
    };
  };
  const pool = new mod.Pool({ connectionString });
  return {
    query: pool.query.bind(pool) as PgQueryable['query'],
    end: () => pool.end(),
  };
}
