import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { funnel } from '../modules/analytics/track.js';
import { audit } from '../modules/audit/audit.js';
import { refundPayment } from '../modules/billing/billing.js';
import { CHANNELS } from '../modules/channels/registry.js';
import { clearFlagCache } from '../modules/flags/flags.js';
import { revokeAllSessions } from '../modules/identity/sessions.js';
import { enqueue, jobStats } from '../modules/jobs/queue.js';
import { addTicketMessage, getTicket } from '../modules/support/support.js';
import { parse, requirePlatformRole, requireUser, zText, zUuid, type Services } from './context.js';

/**
 * Internal platform admin API. Every route requires a platform role; every mutation is audited.
 * Uses the system DB role (cross-tenant) — keep this surface small.
 */
export async function adminRoutes(app: FastifyInstance, s: Services) {
  const { db } = s;
  const staff = async (req: Parameters<typeof requireUser>[0], roles: ('support' | 'admin' | 'superadmin')[] = ['admin', 'superadmin']) => {
    const user = await requireUser(req, s);
    requirePlatformRole(user, roles);
    return user;
  };

  app.get('/api/admin/overview', async (req) => {
    await staff(req, ['support', 'admin', 'superadmin']);
    const counts = await db.system.query(`
      SELECT (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS users,
             (SELECT count(*)::int FROM workspaces WHERE status = 'active') AS workspaces,
             (SELECT count(*)::int FROM trials WHERE status = 'active' AND expires_at > now()) AS active_trials,
             (SELECT count(*)::int FROM subscriptions WHERE status = 'active' AND current_period_end > now()) AS active_subscriptions,
             (SELECT count(*)::int FROM orders WHERE created_at > now() - interval '7 days') AS orders_7d,
             (SELECT coalesce(sum(amount_minor), 0)::text FROM payments WHERE provider = 'telegram_stars' AND status = 'succeeded'
                AND created_at > now() - interval '30 days') AS stars_30d,
             (SELECT count(*)::int FROM support_tickets WHERE status IN ('open', 'pending')) AS open_tickets,
             (SELECT count(*)::int FROM audit_logs WHERE action = 'payment.needs_review' AND created_at > now() - interval '30 days') AS payments_needing_review`);
    return { counts: counts.rows[0], funnel7d: await funnel(db.system, 7) };
  });

  app.get('/api/admin/health', async (req) => {
    await staff(req, ['support', 'admin', 'superadmin']);
    const t0 = Date.now();
    await db.system.query('SELECT 1');
    const dbLatencyMs = Date.now() - t0;
    const backups = await db.system.query(`SELECT kind, status, detail, created_at FROM backup_runs ORDER BY created_at DESC LIMIT 5`);
    const failedJobs = await db.system.query(
      `SELECT id::text, type, last_error, finished_at FROM jobs WHERE status = 'failed' ORDER BY finished_at DESC LIMIT 10`,
    );
    return {
      db: { ok: true, latencyMs: dbLatencyMs },
      jobs: { stats: await jobStats(db.system), recentFailures: failedJobs.rows },
      backups: backups.rows,
      integrations: {
        telegram: s.gateway.configured ? 'configured' : 'not_configured',
        ai: s.ai.configured ? `configured (${s.ai.id})` : 'not_configured',
        channels: CHANNELS.map((c) => ({ platform: c.platform, status: c.status })),
      },
      process: { uptimeSec: Math.round(process.uptime()), rssMb: Math.round(process.memoryUsage().rss / 1e6), node: process.version },
    };
  });

  app.get('/api/admin/users', async (req) => {
    await staff(req, ['support', 'admin', 'superadmin']);
    const qs = parse(z.object({ q: zText(64).optional() }), req.query);
    const term = qs.q?.replace(/^@/, '');
    const res = await db.system.query(
      `SELECT id, telegram_user_id::text, first_name, username, platform_role, is_blocked, created_at FROM users
        WHERE deleted_at IS NULL AND ($1::text IS NULL OR username ILIKE $1 || '%' OR telegram_user_id::text = $1)
        ORDER BY created_at DESC LIMIT 50`,
      [term ?? null],
    );
    return { items: res.rows };
  });

  app.post('/api/admin/users/:id/block', async (req) => {
    const actor = await staff(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(z.object({ blocked: z.boolean(), reason: zText(300, 3) }), req.body);
    if (id === actor.id) throw new AppError('bad_request', 'You cannot block yourself');
    await db.systemTx(async (q) => {
      const target = await q.query('SELECT platform_role FROM users WHERE id = $1', [id]);
      if (!target.rows[0]) throw new AppError('not_found', 'User not found');
      if (target.rows[0].platform_role === 'superadmin') throw new AppError('forbidden', 'Superadmins cannot be blocked here');
      await q.query('UPDATE users SET is_blocked = $2 WHERE id = $1', [id, body.blocked]);
      if (body.blocked) await revokeAllSessions(q, id);
      await audit(q, {
        action: body.blocked ? 'admin.user_blocked' : 'admin.user_unblocked',
        actorUserId: actor.id,
        targetType: 'user',
        targetId: id,
        metadata: { reason: body.reason },
      });
    });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/role', async (req) => {
    const actor = await staff(req, ['superadmin']);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(z.object({ role: z.enum(['user', 'support', 'admin']) }), req.body);
    if (id === actor.id) throw new AppError('bad_request', 'You cannot change your own role');
    await db.systemTx(async (q) => {
      await q.query(`UPDATE users SET platform_role = $2 WHERE id = $1 AND platform_role <> 'superadmin'`, [id, body.role]);
      await revokeAllSessions(q, id);
      await audit(q, {
        action: 'admin.role_changed',
        actorUserId: actor.id,
        targetType: 'user',
        targetId: id,
        metadata: { role: body.role },
      });
    });
    return { ok: true };
  });

  app.get('/api/admin/workspaces', async (req) => {
    await staff(req, ['support', 'admin', 'superadmin']);
    const res = await db.system.query(
      `SELECT w.id, w.name, w.slug, w.status, w.store_published, w.created_at,
              t.status AS trial_status, t.expires_at AS trial_expires_at,
              (SELECT plan_code FROM subscriptions s WHERE s.workspace_id = w.id AND s.status = 'active' LIMIT 1) AS plan
         FROM workspaces w LEFT JOIN trials t ON t.workspace_id = w.id
        ORDER BY w.created_at DESC LIMIT 100`,
    );
    return { items: res.rows };
  });

  app.post('/api/admin/workspaces/:id/status', async (req) => {
    const actor = await staff(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(z.object({ status: z.enum(['active', 'suspended']), reason: zText(300, 3) }), req.body);
    await db.systemTx(async (q) => {
      await q.query(`UPDATE workspaces SET status = $2 WHERE id = $1 AND status <> 'deleted'`, [id, body.status]);
      await audit(q, { action: 'admin.workspace_status', actorUserId: actor.id, workspaceId: id, metadata: body });
    });
    return { ok: true };
  });

  app.get('/api/admin/payments', async (req) => {
    await staff(req);
    const res = await db.system.query(
      `SELECT p.id, p.workspace_id, p.provider, p.amount_minor::text, p.currency, p.status, p.created_at, i.plan_code
         FROM payments p JOIN invoices i ON i.id = p.invoice_id ORDER BY p.created_at DESC LIMIT 100`,
    );
    return { items: res.rows };
  });

  app.post('/api/admin/payments/:id/refund', async (req) => {
    const actor = await staff(req, ['superadmin']);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(z.object({ reason: zText(300, 3) }), req.body);
    await refundPayment(db, s.gateway, id, actor.id, body.reason);
    return { ok: true };
  });

  app.patch('/api/admin/plans/:code', async (req) => {
    const actor = await staff(req, ['superadmin']);
    const { code } = parse(z.object({ code: z.string().regex(/^[a-z0-9_]{2,32}$/) }), req.params);
    const body = parse(
      z
        .object({
          price_stars: z.number().int().min(1).max(100000).optional(),
          price_usdt_micro: z.number().int().min(1).max(1e12).optional(),
          price_trx_sun: z.number().int().min(1).max(1e13).optional(),
          is_active: z.boolean().optional(),
        })
        .strict(),
      req.body,
    );
    await db.systemTx(async (q) => {
      const r = await q.query(
        `UPDATE plans SET price_stars = coalesce($2, price_stars), price_usdt_micro = coalesce($3, price_usdt_micro),
                price_trx_sun = coalesce($4, price_trx_sun), is_active = coalesce($5, is_active) WHERE code = $1 RETURNING code`,
        [code, body.price_stars ?? null, body.price_usdt_micro ?? null, body.price_trx_sun ?? null, body.is_active ?? null],
      );
      if (!r.rows[0]) throw new AppError('not_found', 'Plan not found');
      await audit(q, { action: 'admin.plan_prices_changed', actorUserId: actor.id, targetType: 'plan', targetId: code, metadata: body });
    });
    return { ok: true };
  });

  app.get('/api/admin/flags', async (req) => {
    await staff(req);
    return {
      items: (
        await db.system.query(
          'SELECT key, enabled, rollout_percent, allow_workspaces, description, updated_at FROM feature_flags ORDER BY key',
        )
      ).rows,
    };
  });

  app.patch('/api/admin/flags/:key', async (req) => {
    const actor = await staff(req, ['superadmin']);
    const { key } = parse(z.object({ key: z.string().regex(/^[a-z0-9_.]{2,64}$/) }), req.params);
    const body = parse(
      z.object({ enabled: z.boolean().optional(), rollout_percent: z.number().int().min(0).max(100).optional() }).strict(),
      req.body,
    );
    await db.systemTx(async (q) => {
      const r = await q.query(
        `UPDATE feature_flags SET enabled = coalesce($2, enabled), rollout_percent = coalesce($3, rollout_percent), updated_at = now()
          WHERE key = $1 RETURNING key`,
        [key, body.enabled ?? null, body.rollout_percent ?? null],
      );
      if (!r.rows[0]) throw new AppError('not_found', 'Flag not found');
      await audit(q, { action: 'admin.flag_changed', actorUserId: actor.id, targetType: 'flag', targetId: key, metadata: body });
    });
    clearFlagCache();
    return { ok: true };
  });

  app.get('/api/admin/audit', async (req) => {
    await staff(req);
    const qs = parse(z.object({ action: z.string().max(64).optional() }), req.query);
    const res = await db.system.query(
      `SELECT id::text, workspace_id, actor_user_id, action, target_type, target_id, metadata, created_at FROM audit_logs
        WHERE ($1::text IS NULL OR action = $1) ORDER BY id DESC LIMIT 200`,
      [qs.action ?? null],
    );
    return { items: res.rows };
  });

  app.get('/api/admin/ai-usage', async (req) => {
    await staff(req);
    const res = await db.system.query(
      `SELECT date_trunc('day', created_at) AS day, status, count(*)::int AS n,
              coalesce(sum(input_tokens), 0)::int AS input_tokens, coalesce(sum(output_tokens), 0)::int AS output_tokens
         FROM ai_requests WHERE created_at > now() - interval '14 days' GROUP BY 1, 2 ORDER BY 1 DESC`,
    );
    return { items: res.rows };
  });

  app.get('/api/admin/support', async (req) => {
    await staff(req, ['support', 'admin', 'superadmin']);
    const res = await db.system.query(
      `SELECT id, reference, category, status, subject, created_at, updated_at FROM support_tickets
        ORDER BY (status IN ('open', 'pending')) DESC, updated_at DESC LIMIT 100`,
    );
    return { items: res.rows };
  });
  app.get('/api/admin/support/:id', async (req) => {
    const u = await staff(req, ['support', 'admin', 'superadmin']);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return getTicket(db.system, id, { userId: u.id, asStaff: true });
  });
  app.post('/api/admin/support/:id/reply', async (req) => {
    const u = await staff(req, ['support', 'admin', 'superadmin']);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(z.object({ body: zText(4000, 1), close: z.boolean().optional() }), req.body);
    const owner = await addTicketMessage(db.system, id, { userId: u.id, asStaff: true }, body.body);
    if (body.close) await db.system.query(`UPDATE support_tickets SET status = 'resolved' WHERE id = $1`, [id]);
    await audit(db.system, { action: 'support.replied', actorUserId: u.id, targetType: 'ticket', targetId: id });
    if (owner.tg)
      await enqueue(db.system, 'notify_user', {
        telegramUserId: owner.tg,
        key: 'bot.ticket_reply',
        vars: { ref: owner.reference },
        link: 'support',
      });
    return { ok: true };
  });
}
