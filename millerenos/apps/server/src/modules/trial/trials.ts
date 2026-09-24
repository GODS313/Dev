import { createHmac } from 'node:crypto';
import type { Config } from '../../config.js';
import type { Db, Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { track } from '../analytics/track.js';
import { createWorkspace, type WorkspaceRow } from '../workspace/workspaces.js';

export interface TrialRow {
  id: string;
  user_id: string;
  workspace_id: string;
  started_at: Date;
  expires_at: Date;
  status: 'active' | 'expired' | 'converted';
}

export async function getTrialForUser(q: Queryable, userId: string): Promise<TrialRow | null> {
  const res = await q.query('SELECT * FROM trials WHERE user_id = $1', [userId]);
  return res.rows[0] ?? null;
}

/** Global brake against trial farming with many fresh accounts. */
const MAX_TRIALS_PER_HOUR = 500;

/**
 * Starts the single trial a user is entitled to, creating their first workspace.
 * Idempotent: a second call returns the existing trial with started=false.
 */
export async function startTrial(
  db: Db,
  cfg: Config,
  user: { id: string; first_name: string; locale: 'en' | 'fa'; is_blocked: boolean; telegram_user_id: string | null },
  businessName?: string,
): Promise<{ trial: TrialRow | null; workspace: WorkspaceRow | null; started: boolean }> {
  if (user.is_blocked) throw new AppError('forbidden', 'Account is blocked');
  const existing = await getTrialForUser(db.app, user.id);
  if (existing) return { trial: existing, workspace: null, started: false };
  if (!user.telegram_user_id) throw new AppError('forbidden', 'A Telegram account is required for the free trial');

  // One trial per Telegram identity, even across account deletion.
  const subject = createHmac('sha256', cfg.DATA_HASH_SECRET).update(`tg:${user.telegram_user_id}`).digest();
  const claimed = await db.app.query('SELECT 1 FROM trial_claims WHERE subject_hash = $1', [subject]);
  if (claimed.rows[0]) return { trial: null, workspace: null, started: false };

  const recent = await db.app.query(`SELECT count(*)::int AS n FROM trials WHERE started_at > now() - interval '1 hour'`);
  if (recent.rows[0].n >= MAX_TRIALS_PER_HOUR) {
    throw new AppError('rate_limited', 'Trials are temporarily busy. Please try again shortly.');
  }

  const defaultName = user.locale === 'fa' ? 'کسب‌وکار من' : `${user.first_name || 'My'} Business`.trim();
  const workspace = await createWorkspace(db, user, { name: businessName || defaultName, locale: user.locale });
  const res = await db.app.query(
    `INSERT INTO trials (user_id, workspace_id, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))
     ON CONFLICT (user_id) DO NOTHING RETURNING *`,
    [user.id, workspace.id, cfg.TRIAL_DURATION_MINUTES],
  );
  if (res.rows[0]) {
    await db.app.query('INSERT INTO trial_claims (subject_hash) VALUES ($1) ON CONFLICT DO NOTHING', [subject]);
  }
  if (!res.rows[0]) {
    // Lost a race with a concurrent request: keep the first trial, remove the orphan workspace.
    await db.systemTx((q) => q.query('DELETE FROM workspaces WHERE id = $1', [workspace.id]));
    return { trial: await getTrialForUser(db.app, user.id), workspace: null, started: false };
  }
  await track(db.app, 'trial_started', { userId: user.id, workspaceId: workspace.id });
  await track(db.app, 'store_created', { userId: user.id, workspaceId: workspace.id, props: { source: 'trial' } });
  return { trial: res.rows[0], workspace, started: true };
}

/** Marks due trials expired (data is kept) and returns them so owners can be notified. */
export async function expireDueTrials(q: Queryable): Promise<TrialRow[]> {
  const res = await q.query(`UPDATE trials SET status = 'expired' WHERE status = 'active' AND expires_at <= now() RETURNING *`);
  for (const t of res.rows) await track(q, 'trial_expired', { userId: t.user_id, workspaceId: t.workspace_id });
  return res.rows;
}
