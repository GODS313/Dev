import type { Queryable } from '../../db/pool.js';

export async function upsertTelegramCustomer(
  q: Queryable,
  workspaceId: string,
  tg: { telegramUserId: string; displayName: string },
): Promise<{ id: string; isNew: boolean }> {
  const res = await q.query(
    `INSERT INTO customers (workspace_id, telegram_user_id, display_name) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, telegram_user_id) WHERE telegram_user_id IS NOT NULL
       DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id, (xmax = 0) AS inserted`,
    [workspaceId, tg.telegramUserId, tg.displayName.slice(0, 128)],
  );
  return { id: res.rows[0].id, isNew: res.rows[0].inserted };
}

export async function listCustomers(q: Queryable, workspaceId: string, search?: string) {
  const res = await q.query(
    `SELECT c.id, c.display_name, c.phone, c.created_at,
            (SELECT count(*)::int FROM orders o WHERE o.workspace_id = c.workspace_id AND o.customer_id = c.id) AS orders_count
       FROM customers c
      WHERE c.workspace_id = $1 AND ($2::text IS NULL OR c.display_name ILIKE '%' || $2 || '%')
      ORDER BY c.created_at DESC LIMIT 100`,
    [workspaceId, search ? search.replace(/[%_\\]/g, (m) => '\\' + m) : null],
  );
  return res.rows;
}
