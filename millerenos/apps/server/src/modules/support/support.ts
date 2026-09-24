import type { Queryable } from '../../db/pool.js';
import { randomCode } from '../../lib/crypto.js';
import { notFound } from '../../lib/errors.js';
import { track } from '../analytics/track.js';

export type TicketCategory = 'technical' | 'payment' | 'account' | 'other';

export async function createTicket(
  q: Queryable,
  input: { userId: string; workspaceId?: string | null; category: TicketCategory; subject: string; body: string },
) {
  for (let i = 0; i < 5; i++) {
    const reference = `MLR-${randomCode(6)}`;
    const res = await q.query(
      `INSERT INTO support_tickets (reference, user_id, workspace_id, category, subject) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (reference) DO NOTHING RETURNING id, reference, status, category, subject, created_at`,
      [reference, input.userId, input.workspaceId ?? null, input.category, input.subject],
    );
    if (res.rows[0]) {
      await q.query('INSERT INTO support_messages (ticket_id, author_user_id, body) VALUES ($1, $2, $3)', [res.rows[0].id, input.userId, input.body]);
      await track(q, 'support_ticket_created', { userId: input.userId, props: { category: input.category } });
      return res.rows[0];
    }
  }
  throw new Error('could not allocate ticket reference');
}

export async function listTickets(q: Queryable, userId: string) {
  const res = await q.query(
    `SELECT id, reference, status, category, subject, created_at, updated_at FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId],
  );
  return res.rows;
}

/** Owners see their own tickets; staff (support/admin) see all — checked by caller via `asStaff`. */
export async function getTicket(q: Queryable, id: string, viewer: { userId: string; asStaff: boolean }) {
  const res = await q.query(
    `SELECT id, reference, status, category, subject, user_id, created_at FROM support_tickets WHERE id = $1 AND ($2 OR user_id = $3)`,
    [id, viewer.asStaff, viewer.userId],
  );
  if (!res.rows[0]) throw notFound('Ticket');
  const msgs = await q.query('SELECT id, is_staff, body, created_at FROM support_messages WHERE ticket_id = $1 ORDER BY id', [id]);
  const { user_id: _owner, ...ticket } = res.rows[0];
  return { ...ticket, messages: msgs.rows };
}

export async function addTicketMessage(q: Queryable, id: string, viewer: { userId: string; asStaff: boolean }, body: string) {
  await getTicket(q, id, viewer); // authorization
  await q.query('INSERT INTO support_messages (ticket_id, author_user_id, is_staff, body) VALUES ($1, $2, $3, $4)', [
    id,
    viewer.userId,
    viewer.asStaff,
    body,
  ]);
  await q.query(`UPDATE support_tickets SET status = $2 WHERE id = $1 AND status <> 'closed'`, [id, viewer.asStaff ? 'pending' : 'open']);
  const owner = await q.query('SELECT u.telegram_user_id::text AS tg, t.reference FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = $1', [id]);
  return owner.rows[0] as { tg: string | null; reference: string };
}
