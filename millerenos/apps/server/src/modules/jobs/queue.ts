import type { Queryable } from '../../db/pool.js';

export type JobType = 'notify_user' | 'expire_trials' | 'purge_sessions' | 'process_account_deletions';

export async function enqueue(
  q: Queryable,
  type: JobType,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
) {
  await q.query(
    `INSERT INTO jobs (type, payload, run_at, dedupe_key, max_attempts) VALUES ($1, $2, coalesce($3, now()), $4, $5)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [type, JSON.stringify(payload), opts.runAt ?? null, opts.dedupeKey ?? null, opts.maxAttempts ?? 5],
  );
}

export interface ClaimedJob {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** Claims up to `limit` due jobs; SKIP LOCKED lets several workers run safely. */
export async function claim(q: Queryable, limit = 10): Promise<ClaimedJob[]> {
  const res = await q.query(
    `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
      WHERE id IN (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now()
                   ORDER BY run_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING id::text, type, payload, attempts, max_attempts`,
    [limit],
  );
  return res.rows;
}

export async function complete(q: Queryable, id: string) {
  await q.query(`UPDATE jobs SET status = 'done', finished_at = now(), last_error = NULL WHERE id = $1`, [id]);
}

export async function fail(q: Queryable, job: ClaimedJob, error: string) {
  const final = job.attempts >= job.max_attempts;
  // exponential backoff: 30s, 60s, 120s, ...
  await q.query(
    `UPDATE jobs SET status = $2, last_error = $3, locked_at = NULL,
            run_at = now() + make_interval(secs => $4), finished_at = CASE WHEN $2 = 'failed' THEN now() END
      WHERE id = $1`,
    [job.id, final ? 'failed' : 'queued', error.slice(0, 500), 30 * 2 ** (job.attempts - 1)],
  );
}

/** Jobs stuck in running (crashed worker) are returned to the queue. */
export async function requeueStale(q: Queryable, olderThanMinutes = 10) {
  await q.query(
    `UPDATE jobs SET status = 'queued', locked_at = NULL
      WHERE status = 'running' AND locked_at < now() - make_interval(mins => $1)`,
    [olderThanMinutes],
  );
}

export async function jobStats(q: Queryable) {
  const res = await q.query(
    `SELECT status, count(*)::int AS n FROM jobs WHERE created_at > now() - interval '7 days' GROUP BY status`,
  );
  return Object.fromEntries(res.rows.map((r) => [r.status, r.n])) as Record<string, number>;
}
