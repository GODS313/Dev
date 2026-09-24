import type { Db, Queryable } from '../../db/pool.js';
import { randomToken } from '../../lib/crypto.js';
import { AppError, notFound } from '../../lib/errors.js';
import { track } from '../analytics/track.js';
import { audit } from '../audit/audit.js';
import { isEnabled } from '../flags/flags.js';
import type { TelegramGateway } from './gateway.js';

export async function listPlans(q: Queryable) {
  const res = await q.query('SELECT code, price_stars, period_days, limits FROM plans WHERE is_active ORDER BY sort');
  return res.rows as { code: string; price_stars: number; period_days: number; limits: Record<string, number> }[];
}

export async function billingOverview(q: Queryable, workspaceId: string) {
  const sub = await q.query(
    `SELECT plan_code, status, current_period_start, current_period_end, cancel_at_period_end FROM subscriptions
      WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [workspaceId],
  );
  const invoices = await q.query(
    `SELECT id, purpose, plan_code, provider, currency, amount_minor::text, status, created_at, paid_at
       FROM invoices WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [workspaceId],
  );
  return { subscription: sub.rows[0] ?? null, invoices: invoices.rows };
}

const INVOICE_TTL_MINUTES = 60;

/** Creates a Telegram Stars invoice link for a plan. The Mini App opens it with WebApp.openInvoice. */
export async function createSubscriptionCheckout(
  db: Db,
  gateway: TelegramGateway,
  input: { workspaceId: string; userId: string; planCode: string; locale: 'en' | 'fa' },
) {
  if (!gateway.configured) throw new AppError('not_configured', 'Payments are not configured yet');
  if (!(await isEnabled(db.app, 'payments.telegram_stars', input.workspaceId))) {
    throw new AppError('feature_disabled', 'Checkout is temporarily unavailable');
  }
  const invoice = await db.tenant(input.workspaceId, async (q) => {
    const plan = (await listPlans(q)).find((p) => p.code === input.planCode);
    if (!plan) throw notFound('Plan');
    const nonce = `sub_${randomToken(18)}`;
    const res = await q.query(
      `INSERT INTO invoices (workspace_id, purpose, plan_code, payer_user_id, provider, currency, amount_minor, payload_nonce, expires_at)
       VALUES ($1, 'subscription', $2, $3, 'telegram_stars', 'XTR', $4, $5, now() + make_interval(mins => $6))
       RETURNING id, payload_nonce, amount_minor::int AS amount`,
      [input.workspaceId, plan.code, input.userId, plan.price_stars, nonce, INVOICE_TTL_MINUTES],
    );
    await track(q, 'checkout_started', { userId: input.userId, workspaceId: input.workspaceId, props: { plan: plan.code } });
    return { ...res.rows[0], plan };
  });

  const title = input.locale === 'fa' ? `اشتراک Millerenos — ${invoice.plan.code}` : `Millerenos ${invoice.plan.code} plan`;
  const description =
    input.locale === 'fa'
      ? `دسترسی ${invoice.plan.period_days} روزه به Millerenos`
      : `${invoice.plan.period_days}-day access to Millerenos`;
  const link = await gateway.createStarsInvoiceLink({
    title,
    description,
    payload: invoice.payload_nonce,
    amount: invoice.amount,
    label: title,
  });
  await db.tenant(input.workspaceId, (q) =>
    q.query(`INSERT INTO payment_attempts (workspace_id, invoice_id, stage) VALUES ($1, $2, 'invoice_sent')`, [input.workspaceId, invoice.id]),
  );
  return { invoiceId: invoice.id as string, link };
}

interface InvoiceForPayment {
  id: string;
  workspace_id: string;
  plan_code: string | null;
  purpose: string;
  currency: string;
  amount_minor: string;
  status: string;
  expires_at: Date;
  payer_telegram_id: string | null;
}

async function findInvoiceByPayload(q: Queryable, payload: string, lock = false): Promise<InvoiceForPayment | null> {
  if (!/^sub_[A-Za-z0-9_-]{24}$/.test(payload)) return null;
  const res = await q.query(
    `SELECT i.id, i.workspace_id, i.plan_code, i.purpose, i.currency, i.amount_minor::text, i.status, i.expires_at,
            u.telegram_user_id::text AS payer_telegram_id
       FROM invoices i LEFT JOIN users u ON u.id = i.payer_user_id
      WHERE i.payload_nonce = $1 ${lock ? 'FOR UPDATE OF i' : ''}`,
    [payload],
  );
  return res.rows[0] ?? null;
}

/**
 * pre_checkout_query must be answered within 10 seconds. We re-validate everything
 * server-side: invoice exists, is open, not expired, and amount/currency/payer match.
 */
export async function validatePreCheckout(
  db: Db,
  input: { payload: string; currency: string; totalAmount: number; fromTelegramId: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return db.systemTx(async (q) => {
    const inv = await findInvoiceByPayload(q, input.payload);
    let reason: string | null = null;
    if (!inv) reason = 'unknown_invoice';
    else if (inv.status !== 'open') reason = 'invoice_not_open';
    else if (inv.expires_at <= new Date()) reason = 'invoice_expired';
    else if (inv.currency !== input.currency || inv.amount_minor !== String(input.totalAmount)) reason = 'amount_mismatch';
    else if (inv.payer_telegram_id !== input.fromTelegramId) reason = 'payer_mismatch';
    if (inv) {
      await q.query(`INSERT INTO payment_attempts (workspace_id, invoice_id, stage, reason) VALUES ($1, $2, $3, $4)`, [
        inv.workspace_id,
        inv.id,
        reason ? 'pre_checkout_rejected' : 'pre_checkout_ok',
        reason,
      ]);
    }
    return reason ? { ok: false as const, reason } : { ok: true as const };
  });
}

export type PaymentOutcome =
  | { kind: 'duplicate' }
  | { kind: 'activated'; workspaceId: string; planCode: string; periodEnd: Date; renewed: boolean }
  | { kind: 'needs_review'; workspaceId: string | null; reason: string };

/**
 * Handles successful_payment exactly once per charge id (webhook_events + unique
 * (provider, provider_charge_id) protect against replays and duplicate deliveries).
 */
export async function recordSuccessfulPayment(
  db: Db,
  input: { payload: string; currency: string; totalAmount: number; chargeId: string; fromTelegramId: string },
): Promise<PaymentOutcome> {
  return db.systemTx(async (q) => {
    const ev = await q.query(
      `INSERT INTO webhook_events (provider, event_id) VALUES ('telegram_stars', $1) ON CONFLICT DO NOTHING RETURNING id`,
      [input.chargeId],
    );
    if (!ev.rows[0]) return { kind: 'duplicate' as const };

    const inv = await findInvoiceByPayload(q, input.payload, true);
    if (!inv) {
      await audit(q, { action: 'payment.orphan', metadata: { chargeId: input.chargeId, amount: input.totalAmount } });
      return { kind: 'needs_review' as const, workspaceId: null, reason: 'unknown_invoice' };
    }
    await q.query(
      `INSERT INTO payments (workspace_id, invoice_id, provider, provider_charge_id, currency, amount_minor)
       VALUES ($1, $2, 'telegram_stars', $3, $4, $5)`,
      [inv.workspace_id, inv.id, input.chargeId, input.currency, input.totalAmount],
    );
    const mismatch =
      inv.status !== 'open'
        ? 'invoice_not_open'
        : inv.currency !== input.currency || inv.amount_minor !== String(input.totalAmount)
          ? 'amount_mismatch'
          : null;
    if (mismatch || inv.purpose !== 'subscription' || !inv.plan_code) {
      // Money was received but cannot be applied automatically → flag for admin (refund or manual apply).
      await audit(q, {
        action: 'payment.needs_review',
        workspaceId: inv.workspace_id,
        targetType: 'invoice',
        targetId: inv.id,
        metadata: { reason: mismatch ?? 'unsupported_purpose' },
      });
      return { kind: 'needs_review' as const, workspaceId: inv.workspace_id, reason: mismatch ?? 'unsupported_purpose' };
    }

    await q.query(`UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1`, [inv.id]);
    const plan = await q.query('SELECT period_days FROM plans WHERE code = $1', [inv.plan_code]);
    const days = plan.rows[0].period_days as number;
    // expire lapsed subscriptions, then extend the current one or start a new period
    await q.query(`UPDATE subscriptions SET status = 'expired' WHERE workspace_id = $1 AND status = 'active' AND current_period_end <= now()`, [
      inv.workspace_id,
    ]);
    const cur = await q.query(`SELECT id FROM subscriptions WHERE workspace_id = $1 AND status = 'active' FOR UPDATE`, [inv.workspace_id]);
    let periodEnd: Date;
    const renewed = Boolean(cur.rows[0]);
    if (cur.rows[0]) {
      const r = await q.query(
        `UPDATE subscriptions SET plan_code = $2, current_period_end = current_period_end + make_interval(days => $3), cancel_at_period_end = false
          WHERE id = $1 RETURNING current_period_end`,
        [cur.rows[0].id, inv.plan_code, days],
      );
      periodEnd = r.rows[0].current_period_end;
    } else {
      const r = await q.query(
        `INSERT INTO subscriptions (workspace_id, plan_code, status, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', now(), now() + make_interval(days => $3)) RETURNING current_period_end`,
        [inv.workspace_id, inv.plan_code, days],
      );
      periodEnd = r.rows[0].current_period_end;
    }
    await q.query(`UPDATE trials SET status = 'converted', converted_at = now() WHERE workspace_id = $1 AND status <> 'converted'`, [
      inv.workspace_id,
    ]);
    await q.query('UPDATE webhook_events SET processed_at = now() WHERE id = $1', [ev.rows[0].id]);
    await track(q, 'payment_completed', { workspaceId: inv.workspace_id, props: { plan: inv.plan_code, provider: 'telegram_stars' } });
    await track(q, renewed ? 'subscription_renewed' : 'subscription_started', { workspaceId: inv.workspace_id, props: { plan: inv.plan_code } });
    return { kind: 'activated' as const, workspaceId: inv.workspace_id, planCode: inv.plan_code, periodEnd, renewed };
  });
}

/** Admin-initiated full refund of a Stars payment. */
export async function refundPayment(db: Db, gateway: TelegramGateway, paymentId: string, actorUserId: string, reason: string) {
  const p = await db.system.query(
    `SELECT p.id, p.workspace_id, p.invoice_id, p.provider, p.provider_charge_id, p.amount_minor::text, p.status,
            u.telegram_user_id::text AS payer
       FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN users u ON u.id = i.payer_user_id WHERE p.id = $1`,
    [paymentId],
  );
  const pay = p.rows[0];
  if (!pay) throw notFound('Payment');
  if (pay.status !== 'succeeded') throw new AppError('conflict', 'Payment already refunded');
  if (pay.provider !== 'telegram_stars' || !pay.payer) throw new AppError('bad_request', 'Refund not supported for this payment');
  try {
    await gateway.refundStarPayment(pay.payer, pay.provider_charge_id);
  } catch {
    await db.systemTx((q) =>
      q.query(
        `INSERT INTO refunds (workspace_id, payment_id, amount_minor, status, reason, actor_user_id) VALUES ($1, $2, $3, 'failed', $4, $5)`,
        [pay.workspace_id, pay.id, pay.amount_minor, reason, actorUserId],
      ),
    );
    throw new AppError('payment_error', 'Refund failed at provider');
  }
  await db.systemTx(async (q) => {
    await q.query(
      `INSERT INTO refunds (workspace_id, payment_id, amount_minor, status, reason, actor_user_id) VALUES ($1, $2, $3, 'succeeded', $4, $5)`,
      [pay.workspace_id, pay.id, pay.amount_minor, reason, actorUserId],
    );
    await q.query(`UPDATE payments SET status = 'refunded' WHERE id = $1`, [pay.id]);
    await q.query(`UPDATE invoices SET status = 'refunded' WHERE id = $1`, [pay.invoice_id]);
    await q.query(`UPDATE subscriptions SET status = 'cancelled', current_period_end = greatest(current_period_start + interval '1 second', now())
                    WHERE workspace_id = $1 AND status = 'active'`, [pay.workspace_id]);
    await audit(q, { action: 'payment.refunded', actorUserId, workspaceId: pay.workspace_id, targetType: 'payment', targetId: pay.id, metadata: { reason } });
    await track(q, 'subscription_cancelled', { workspaceId: pay.workspace_id, props: { cause: 'refund' } });
  });
}
