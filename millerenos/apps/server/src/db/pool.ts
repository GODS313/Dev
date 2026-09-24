import pg from 'pg';

// bigint columns (e.g. telegram ids, order numbers) come back as strings; keep them as strings
// in JS and convert explicitly where needed to avoid silent precision loss.
export type Queryable = Pick<pg.PoolClient, 'query'>;

export interface Db {
  app: pg.Pool;
  system: pg.Pool;
  /** Runs fn in a transaction where RLS restricts every tenant table to workspaceId. */
  tenant<T>(workspaceId: string, fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Cross-tenant transaction (admin, worker, public store resolution). Use sparingly. */
  systemTx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function inTx<T>(pool: pg.Pool, setup: string | null, params: unknown[], fn: (q: Queryable) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (setup) await client.query(setup, params);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function createDb(opts: { appUrl: string; systemUrl: string; max: number }): Db {
  const common = { max: opts.max, idleTimeoutMillis: 30_000, statement_timeout: 15_000, application_name: 'millerenos' };
  const app = new pg.Pool({ connectionString: opts.appUrl, ...common });
  const system = new pg.Pool({ connectionString: opts.systemUrl, ...common, max: Math.max(2, Math.ceil(opts.max / 2)) });
  return {
    app,
    system,
    tenant(workspaceId, fn) {
      if (!UUID_RE.test(workspaceId)) throw new Error('invalid workspace id');
      return inTx(app, "SELECT set_config('app.workspace_id', $1, true)", [workspaceId], fn);
    },
    systemTx(fn) {
      return inTx(system, null, [], fn);
    },
    async close() {
      await Promise.all([app.end(), system.end()]);
    },
  };
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
