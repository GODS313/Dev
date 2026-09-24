import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { revokeAllSessions } from '../identity/sessions.js';

const DELETION_GRACE_DAYS = 14;

/** Export of the personal data Millerenos holds about the user (JSON). */
export async function exportUserData(q: Queryable, userId: string) {
  const user = await q.query('SELECT id, telegram_user_id::text, first_name, username, locale, created_at FROM users WHERE id = $1', [
    userId,
  ]);
  const memberships = await q.query('SELECT workspace_id, role, created_at FROM workspace_members WHERE user_id = $1', [userId]);
  const trials = await q.query('SELECT started_at, expires_at, status FROM trials WHERE user_id = $1', [userId]);
  const tickets = await q.query(
    `SELECT t.reference, t.subject, t.status, t.created_at,
            (SELECT json_agg(json_build_object('body', m.body, 'at', m.created_at, 'staff', m.is_staff) ORDER BY m.id)
               FROM support_messages m WHERE m.ticket_id = t.id) AS messages
       FROM support_tickets t WHERE t.user_id = $1`,
    [userId],
  );
  return {
    generatedAt: new Date().toISOString(),
    user: user.rows[0],
    memberships: memberships.rows,
    trials: trials.rows,
    supportTickets: tickets.rows,
    note: 'Business data inside your workspaces (products, orders, customers) can be exported from each workspace.',
  };
}

export async function requestDeletion(q: Queryable, userId: string) {
  const owned = await q.query(`SELECT count(*)::int AS n FROM workspace_members WHERE user_id = $1 AND role = 'owner'`, [userId]);
  const res = await q.query(
    `INSERT INTO account_deletion_requests (user_id, execute_after) VALUES ($1, now() + make_interval(days => $2))
     ON CONFLICT (user_id) DO UPDATE SET requested_at = account_deletion_requests.requested_at
     RETURNING execute_after`,
    [userId, DELETION_GRACE_DAYS],
  );
  return { executeAfter: res.rows[0].execute_after as Date, ownedWorkspaces: owned.rows[0].n as number };
}

export async function cancelDeletion(q: Queryable, userId: string) {
  const res = await q.query('DELETE FROM account_deletion_requests WHERE user_id = $1 AND completed_at IS NULL RETURNING 1', [userId]);
  if (!res.rows[0]) throw new AppError('not_found', 'No pending deletion request');
}

/**
 * Executes due deletions: anonymizes the user, revokes sessions and suspends owned workspaces.
 * Payment/invoice records are retained (legal/accounting) but no longer linked to personal data.
 */
export async function processDueDeletions(q: Queryable) {
  const due = await q.query(
    `SELECT user_id FROM account_deletion_requests WHERE completed_at IS NULL AND execute_after <= now() LIMIT 50 FOR UPDATE SKIP LOCKED`,
  );
  for (const { user_id } of due.rows) {
    await revokeAllSessions(q, user_id);
    await q.query(`UPDATE workspaces SET status = 'deleted', store_published = false WHERE owner_user_id = $1`, [user_id]);
    await q.query(
      `UPDATE users SET telegram_user_id = NULL, first_name = '', username = NULL, deleted_at = now(), is_blocked = true WHERE id = $1`,
      [user_id],
    );
    await q.query('UPDATE account_deletion_requests SET completed_at = now() WHERE user_id = $1', [user_id]);
  }
  return due.rows.length;
}
