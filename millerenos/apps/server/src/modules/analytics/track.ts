import type { Queryable } from '../../db/pool.js';

/** Allow-list of funnel events. Unknown names are rejected so analytics stays a deliberate contract. */
export const EVENTS = [
  'bot_started',
  'language_selected',
  'trial_started',
  'trial_activated',
  'trial_expired',
  'miniapp_opened',
  'store_created',
  'store_published',
  'product_created',
  'channel_connected',
  'first_customer_message',
  'first_order',
  'order_created',
  'checkout_started',
  'payment_completed',
  'subscription_started',
  'subscription_renewed',
  'subscription_cancelled',
  'referral_created',
  'referral_signup',
  'ai_suggestion_generated',
  'support_ticket_created',
] as const;
export type EventName = (typeof EVENTS)[number];

type Primitive = string | number | boolean | null;

/** Only short primitive props are stored; never message bodies, names, phones or tokens. */
export function sanitizeProps(props: Record<string, unknown> = {}): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  for (const [k, v] of Object.entries(props).slice(0, 12)) {
    if (!/^[a-z_]{1,32}$/.test(k)) continue;
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 64);
  }
  return out;
}

export async function track(
  q: Queryable,
  name: EventName,
  ctx: { userId?: string | null; workspaceId?: string | null; props?: Record<string, unknown> } = {},
) {
  if (!EVENTS.includes(name)) throw new Error(`unknown analytics event ${name}`);
  await q.query('INSERT INTO analytics_events (name, user_id, workspace_id, props) VALUES ($1, $2, $3, $4)', [
    name,
    ctx.userId ?? null,
    ctx.workspaceId ?? null,
    JSON.stringify(sanitizeProps(ctx.props)),
  ]);
}

/** Funnel counts for the admin dashboard (distinct users per step). */
export async function funnel(q: Queryable, sinceDays: number) {
  const res = await q.query(
    `SELECT name, count(DISTINCT coalesce(user_id::text, workspace_id::text))::int AS n
       FROM analytics_events WHERE created_at > now() - make_interval(days => $1)
      GROUP BY name`,
    [sinceDays],
  );
  return Object.fromEntries(res.rows.map((r) => [r.name, r.n])) as Record<string, number>;
}
