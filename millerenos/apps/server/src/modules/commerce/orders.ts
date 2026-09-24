import type { Queryable } from '../../db/pool.js';
import { AppError, notFound } from '../../lib/errors.js';

export type OrderStatus = 'pending' | 'confirmed' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';

/** Allowed state machine. Anything else is rejected. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'paid', 'cancelled'],
  confirmed: ['paid', 'fulfilled', 'cancelled'],
  paid: ['fulfilled', 'refunded'],
  fulfilled: ['refunded'],
  cancelled: [],
  refunded: [],
};

export interface OrderInput {
  items: { variantId: string; quantity: number }[];
  customerId?: string | null;
  couponCode?: string | null;
  note?: string;
  channel: 'telegram' | 'web' | 'manual' | 'api';
  idempotencyKey: string;
  actorUserId?: string | null;
}

/**
 * Creates an order with server-side pricing. Prices, stock and discounts are read from the
 * database under row locks — client-supplied prices are never used. Idempotent per key.
 */
export async function createOrder(q: Queryable, workspaceId: string, input: OrderInput) {
  const existing = await q.query('SELECT id FROM orders WHERE workspace_id = $1 AND idempotency_key = $2', [
    workspaceId,
    input.idempotencyKey,
  ]);
  if (existing.rows[0]) return { order: await getOrder(q, workspaceId, existing.rows[0].id), created: false };

  if (!input.items.length || input.items.length > 50) throw new AppError('validation_failed', 'Order must have 1-50 items');
  const merged = new Map<string, number>();
  for (const it of input.items) merged.set(it.variantId, (merged.get(it.variantId) ?? 0) + it.quantity);

  const ws = await q.query('SELECT currency FROM workspaces WHERE id = $1', [workspaceId]);
  if (!ws.rows[0]) throw notFound('Workspace');
  const currency = ws.rows[0].currency as string;

  const variants = await q.query(
    `SELECT v.id, v.name, v.price_minor, v.stock, p.name AS product_name
       FROM product_variants v JOIN products p ON p.id = v.product_id AND p.workspace_id = v.workspace_id
      WHERE v.workspace_id = $1 AND v.id = ANY($2::uuid[]) AND v.is_active AND p.status = 'active'
      ORDER BY v.id FOR UPDATE OF v`,
    [workspaceId, [...merged.keys()]],
  );
  if (variants.rows.length !== merged.size) throw new AppError('validation_failed', 'One or more items are unavailable');

  let subtotal = 0n;
  const lines = variants.rows.map((v) => {
    const qty = merged.get(v.id)!;
    if (qty < 1 || qty > 999) throw new AppError('validation_failed', 'Invalid quantity');
    if (v.stock !== null && v.stock < qty) throw new AppError('conflict', `Not enough stock for ${v.product_name}`, { variantId: v.id });
    const unit = BigInt(v.price_minor);
    subtotal += unit * BigInt(qty);
    return { ...v, qty, unit };
  });

  let discount = 0n;
  let couponId: string | null = null;
  if (input.couponCode) {
    const c = await q.query(
      `SELECT id, kind, value FROM coupons
        WHERE workspace_id = $1 AND code = $2 AND is_active
          AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
          AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
        FOR UPDATE`,
      [workspaceId, input.couponCode.toUpperCase()],
    );
    if (!c.rows[0]) throw new AppError('validation_failed', 'Coupon is not valid');
    const coupon = c.rows[0];
    discount = coupon.kind === 'percent' ? (subtotal * BigInt(coupon.value)) / 100n : BigInt(coupon.value);
    if (discount > subtotal) discount = subtotal;
    couponId = coupon.id;
    await q.query('UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE id = $1', [couponId]);
  }

  const seq = await q.query('UPDATE workspaces SET order_seq = order_seq + 1 WHERE id = $1 RETURNING order_seq', [workspaceId]);
  const order = await q.query(
    `INSERT INTO orders (workspace_id, number, customer_id, coupon_id, channel, currency,
                         subtotal_minor, discount_minor, total_minor, customer_note, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      workspaceId,
      seq.rows[0].order_seq,
      input.customerId ?? null,
      couponId,
      input.channel,
      currency,
      subtotal.toString(),
      discount.toString(),
      (subtotal - discount).toString(),
      (input.note ?? '').slice(0, 1000),
      input.idempotencyKey,
    ],
  );
  const orderId = order.rows[0].id as string;
  for (const l of lines) {
    await q.query(
      `INSERT INTO order_items (workspace_id, order_id, variant_id, product_name, variant_name, unit_price_minor, quantity, line_total_minor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [workspaceId, orderId, l.id, l.product_name, l.name, l.unit.toString(), l.qty, (l.unit * BigInt(l.qty)).toString()],
    );
    if (l.stock !== null) {
      await q.query('UPDATE product_variants SET stock = stock - $3 WHERE workspace_id = $1 AND id = $2', [workspaceId, l.id, l.qty]);
    }
  }
  await q.query(
    `INSERT INTO order_status_history (workspace_id, order_id, from_status, to_status, actor_user_id) VALUES ($1, $2, NULL, 'pending', $3)`,
    [workspaceId, orderId, input.actorUserId ?? null],
  );
  return { order: await getOrder(q, workspaceId, orderId), created: true };
}

export async function getOrder(q: Queryable, workspaceId: string, id: string) {
  const res = await q.query(
    `SELECT o.id, o.number::text, o.status, o.channel, o.currency, o.subtotal_minor::text, o.discount_minor::text,
            o.total_minor::text, o.customer_note, o.created_at, o.updated_at,
            c.id AS customer_id, c.display_name AS customer_name,
            coalesce((SELECT json_agg(json_build_object('product_name', i.product_name, 'variant_name', i.variant_name,
                        'unit_price_minor', i.unit_price_minor::text, 'quantity', i.quantity,
                        'line_total_minor', i.line_total_minor::text))
                      FROM order_items i WHERE i.workspace_id = o.workspace_id AND i.order_id = o.id), '[]') AS items
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id AND c.workspace_id = o.workspace_id
      WHERE o.workspace_id = $1 AND o.id = $2`,
    [workspaceId, id],
  );
  if (!res.rows[0]) throw notFound('Order');
  return res.rows[0];
}

export async function listOrders(q: Queryable, workspaceId: string, opts: { status?: string; limit?: number; cursor?: string } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const res = await q.query(
    `SELECT o.id, o.number::text, o.status, o.channel, o.currency, o.total_minor::text, o.created_at, c.display_name AS customer_name
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id AND c.workspace_id = o.workspace_id
      WHERE o.workspace_id = $1 AND ($2::text IS NULL OR o.status = $2) AND ($3::timestamptz IS NULL OR o.created_at < $3)
      ORDER BY o.created_at DESC LIMIT $4`,
    [workspaceId, opts.status ?? null, opts.cursor ?? null, limit + 1],
  );
  const rows = res.rows.slice(0, limit);
  return { items: rows, nextCursor: res.rows.length > limit ? rows[rows.length - 1]!.created_at.toISOString() : null };
}

export async function countOrders(q: Queryable, workspaceId: string): Promise<number> {
  const res = await q.query('SELECT count(*)::int AS n FROM orders WHERE workspace_id = $1', [workspaceId]);
  return res.rows[0].n;
}

export async function transitionOrder(q: Queryable, workspaceId: string, id: string, to: OrderStatus, actorUserId: string) {
  const cur = await q.query('SELECT status FROM orders WHERE workspace_id = $1 AND id = $2 FOR UPDATE', [workspaceId, id]);
  if (!cur.rows[0]) throw notFound('Order');
  const from = cur.rows[0].status as OrderStatus;
  if (!TRANSITIONS[from].includes(to)) throw new AppError('conflict', `Cannot change order from ${from} to ${to}`);
  await q.query('UPDATE orders SET status = $3 WHERE workspace_id = $1 AND id = $2', [workspaceId, id, to]);
  if (to === 'cancelled') {
    // return tracked stock
    await q.query(
      `UPDATE product_variants v SET stock = v.stock + i.quantity
         FROM order_items i WHERE i.workspace_id = $1 AND i.order_id = $2 AND v.workspace_id = $1 AND v.id = i.variant_id AND v.stock IS NOT NULL`,
      [workspaceId, id],
    );
  }
  await q.query(
    'INSERT INTO order_status_history (workspace_id, order_id, from_status, to_status, actor_user_id) VALUES ($1, $2, $3, $4, $5)',
    [workspaceId, id, from, to, actorUserId],
  );
  return getOrder(q, workspaceId, id);
}
