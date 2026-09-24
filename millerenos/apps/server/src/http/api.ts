import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { track } from '../modules/analytics/track.js';
import { audit } from '../modules/audit/audit.js';
import { draftProductDescription, reviewSuggestion, suggestReply } from '../modules/ai/assistant.js';
import { billingOverview, createSubscriptionCheckout, listPlans } from '../modules/billing/billing.js';
import { PAYMENT_PROVIDERS } from '../modules/billing/providers.js';
import { CHANNELS } from '../modules/channels/registry.js';
import {
  assertCategory,
  countProducts,
  createCategory,
  createProduct,
  getProduct,
  listCategories,
  listProducts,
  updateProduct,
} from '../modules/commerce/catalog.js';
import { listCustomers, upsertTelegramCustomer } from '../modules/commerce/customers.js';
import { countOrders, createOrder, getOrder, listOrders, transitionOrder } from '../modules/commerce/orders.js';
import { publicCatalog, resolvePublicStore } from '../modules/commerce/storefront.js';
import { DOMAIN_PROVIDERS } from '../modules/domains/providers.js';
import { isEnabled } from '../modules/flags/flags.js';
import { createSession, revokeSession } from '../modules/identity/sessions.js';
import { validateInitData } from '../modules/identity/telegram-auth.js';
import { setLocale, upsertTelegramUser } from '../modules/identity/users.js';
import { enqueue } from '../modules/jobs/queue.js';
import { addTicketMessage, createTicket, getTicket, listTickets } from '../modules/support/support.js';
import { cancelDeletion, exportUserData, requestDeletion } from '../modules/account/account.js';
import { getAccess, requireWriteAccess } from '../modules/trial/access.js';
import { getTrialForUser, startTrial } from '../modules/trial/trials.js';
import {
  getWorkspace,
  listUserWorkspaces,
  onboardingChecklist,
  requireRole,
  updateWorkspace,
  type Role,
} from '../modules/workspace/workspaces.js';
import { bearer, parse, requireUser, zText, zUuid, type Services } from './context.js';

const zLocale = z.enum(['en', 'fa']);
const zMoney = z.number().int().min(0).max(1e13);
const zIdem = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

export async function apiRoutes(app: FastifyInstance, s: Services) {
  const { db, cfg } = s;

  /** Loads the user, checks membership/role and runs fn inside the tenant transaction. */
  async function inWorkspace<T>(
    req: { params: unknown; headers: Record<string, unknown> } & Parameters<typeof requireUser>[0],
    min: Role,
    fn: (ctx: { q: import('../db/pool.js').Queryable; wid: string; userId: string; role: Role; locale: 'en' | 'fa' }) => Promise<T>,
  ): Promise<T> {
    const user = await requireUser(req, s);
    const { wid } = parse(z.object({ wid: zUuid }).passthrough(), req.params);
    return db.tenant(wid, async (q) => {
      const role = await requireRole(q, wid, user.id, min);
      return fn({ q, wid, userId: user.id, role, locale: user.locale });
    });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  app.post('/api/v1/auth/telegram', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    if (!cfg.TELEGRAM_BOT_TOKEN) throw new AppError('not_configured', 'Telegram sign-in is not configured');
    const body = parse(z.object({ initData: z.string().min(1).max(4096) }), req.body);
    const v = validateInitData(body.initData, cfg.TELEGRAM_BOT_TOKEN, cfg.INIT_DATA_MAX_AGE_SECONDS);
    const { user } = await upsertTelegramUser(db.app, v.user, cfg.PLATFORM_ADMIN_TELEGRAM_IDS);
    if (user.is_blocked) throw new AppError('forbidden', 'Account is blocked');
    const session = await createSession(db.app, user.id, cfg.SESSION_TTL_HOURS);
    const workspaces = await listUserWorkspaces(db, user.id);
    await track(db.app, 'miniapp_opened', { userId: user.id, props: { has_workspace: workspaces.length > 0 } });
    return { token: session.token, expiresAt: session.expiresAt, user: publicUser(user), workspaces, startParam: v.startParam ?? null };
  });

  app.post('/api/v1/auth/logout', async (req) => {
    const token = bearer(req);
    if (token) await revokeSession(db.app, token);
    return { ok: true };
  });

  app.get('/api/v1/me', async (req) => {
    const user = await requireUser(req, s);
    const trial = await getTrialForUser(db.app, user.id);
    return { user: publicUser(user), workspaces: await listUserWorkspaces(db, user.id), trialUsed: Boolean(trial) };
  });

  app.patch('/api/v1/me', async (req) => {
    const user = await requireUser(req, s);
    const body = parse(z.object({ locale: zLocale }), req.body);
    await setLocale(db.app, user.id, body.locale);
    return { ok: true };
  });

  // ── Trial / workspaces ───────────────────────────────────────────────────
  app.post('/api/v1/trial', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req, s);
    const body = parse(z.object({ businessName: zText(80, 1).optional() }), req.body ?? {});
    const r = await startTrial(db, cfg, user, body.businessName);
    if (!r.started) throw new AppError('conflict', 'Free trial already used');
    await track(db.app, 'trial_activated', { userId: user.id, workspaceId: r.workspace!.id, props: { via: 'miniapp' } });
    return { workspace: r.workspace, trial: { expiresAt: r.trial!.expires_at } };
  });

  app.get('/api/v1/workspaces/:wid', async (req) =>
    inWorkspace(req, 'staff', async ({ q, wid, role }) => {
      const ws = await getWorkspace(q, wid);
      const access = await getAccess(q, wid, cfg);
      return {
        workspace: ws,
        role,
        access,
        onboarding: await onboardingChecklist(q, wid),
        usage: { products: await countProducts(q, wid), orders: await countOrders(q, wid) },
        storeLink: storeLink(ws.slug),
      };
    }),
  );

  const zStoreSettings = z
    .object({
      tagline: zText(160).optional(),
      support_contact: zText(120).optional(),
      delivery_info: zText(500).optional(),
    })
    .strict();

  app.patch('/api/v1/workspaces/:wid', async (req) =>
    inWorkspace(req, 'admin', async ({ q, wid, userId }) => {
      const body = parse(
        z
          .object({
            name: zText(80, 1).optional(),
            default_locale: zLocale.optional(),
            currency: z
              .string()
              .regex(/^[A-Z]{3}$/)
              .optional(),
            ai_mode: z.enum(['MANUAL', 'SUGGEST_ONLY', 'APPROVAL_REQUIRED', 'AUTO_ALLOWED']).optional(),
            business_policies: zText(4000).optional(),
            store_published: z.boolean().optional(),
            store_settings: zStoreSettings.optional(),
          })
          .strict(),
        req.body,
      );
      if (body.store_published) requireWriteAccess(await getAccess(q, wid, cfg));
      if (body.currency) {
        const n = await countOrders(q, wid);
        if (n > 0) throw new AppError('conflict', 'Currency cannot change after the first order');
      }
      const before = await getWorkspace(q, wid);
      const ws = await updateWorkspace(q, wid, body);
      await audit(q, { action: 'workspace.updated', actorUserId: userId, workspaceId: wid, metadata: { fields: Object.keys(body) } });
      if (body.store_published && !before.store_published) await track(q, 'store_published', { userId, workspaceId: wid });
      return { workspace: ws };
    }),
  );

  // ── Catalog ──────────────────────────────────────────────────────────────
  app.get('/api/v1/workspaces/:wid/categories', async (req) =>
    inWorkspace(req, 'staff', async ({ q, wid }) => ({ items: await listCategories(q, wid) })),
  );
  app.post('/api/v1/workspaces/:wid/categories', async (req) =>
    inWorkspace(req, 'admin', async ({ q, wid }) => {
      requireWriteAccess(await getAccess(q, wid, cfg));
      const body = parse(z.object({ name: zText(80, 1) }), req.body);
      return createCategory(q, wid, body.name);
    }),
  );

  const zProduct = z
    .object({
      name: zText(120, 1),
      description: zText(4000).optional(),
      kind: z.enum(['physical', 'service', 'digital']).optional(),
      categoryId: zUuid.nullable().optional(),
      status: z.enum(['draft', 'active', 'archived']).optional(),
      priceMinor: zMoney,
      stock: z.number().int().min(0).max(1_000_000).nullable().optional(),
      sku: zText(64).nullable().optional(),
    })
    .strict();

  app.get('/api/v1/workspaces/:wid/products', async (req) =>
    inWorkspace(req, 'staff', async ({ q, wid }) => {
      const qs = parse(
        z.object({
          status: z.enum(['draft', 'active', 'archived']).optional(),
          cursor: z.iso.datetime().optional(),
          limit: z.coerce.number().optional(),
        }),
        req.query,
      );
      return listProducts(q, wid, qs);
    }),
  );
  app.post('/api/v1/workspaces/:wid/products', async (req) =>
    inWorkspace(req, 'staff', async ({ q, wid, userId }) => {
      const body = parse(zProduct, req.body);
      const access = await getAccess(q, wid, cfg);
      requireWriteAccess(access);
      if ((await countProducts(q, wid)) >= access.limits.products) {
        throw new AppError('quota_exceeded', 'Product limit reached for your plan', { limit: access.limits.products });
      }
      await assertCategory(q, wid, body.categoryId);
      const product = await createProduct(q, wid, body);
      await track(q, 'product_created', { userId, workspaceId: wid });
      return product;
    }),
  );
  app.get('/api/v1/workspaces/:wid/products/:pid', async (req) =>
    inWorkspace(req, 'staff', async ({ q, wid }) => getProduct(q, wid, parse(z.object({ pid: zUuid }).passthrough(), req.params).pid)),
  );
  app.patch('/api/v1/workspaces/:wid/products/:pid', async (req) =>
    inWorkspace(req, 'staff', async ({ q, wid }) => {
      const { pid } = parse(z.object({ pid: zUuid }).passthrough(), req.params);
      const body = parse(zProduct.partial(), req.body);
      requireWriteAccess(await getAccess(q, wid, cfg));
      await assertCategory(q, wid, body.categoryId);
      return updateProduct(q, wid, pid, body);
    }),
  );

  // ── Orders & customers ───────────────────────────────────────────────────
  app.get('/api/v1/workspaces/:wid/orders', async (req) =>
    inWorkspace(req, 'staff', async ({ q, wid }) => {
      const qs = parse(
        z.object({
          status: z.enum(['pending', 'confirmed', 'paid', 'fulfilled', 'cancelled', 'refunded']).optional(),
          cursor: z.iso.datetime().optional(),
          limit: z.coerce.number().optional(),
        }),
        req.query,
      );
      return listOrders(q, wid, qs);
    }),
  );
  app.get('/api/v1/workspaces/:wid/orders/:oid', async (req) =>
    inWorkspace(req, 'staff', async ({ q, wid }) => getOrder(q, wid, parse(z.object({ oid: zUuid }).passthrough(), req.params).oid)),
  );
  app.post('/api/v1/workspaces/:wid/orders/:oid/status', async (req) =>
    inWorkspace(req, 'staff', async ({ q, wid, userId }) => {
      const { oid } = parse(z.object({ oid: zUuid }).passthrough(), req.params);
      const body = parse(z.object({ status: z.enum(['confirmed', 'paid', 'fulfilled', 'cancelled', 'refunded']) }), req.body);
      const order = await transitionOrder(q, wid, oid, body.status, userId);
      await audit(q, {
        action: 'order.status_changed',
        actorUserId: userId,
        workspaceId: wid,
        targetType: 'order',
        targetId: oid,
        metadata: { to: body.status },
      });
      return order;
    }),
  );
  app.get('/api/v1/workspaces/:wid/customers', async (req) =>
    inWorkspace(req, 'staff', async ({ q, wid }) => {
      const qs = parse(z.object({ q: zText(80).optional() }), req.query);
      return { items: await listCustomers(q, wid, qs.q) };
    }),
  );

  // ── FAQ (AI grounding) ───────────────────────────────────────────────────
  app.get('/api/v1/workspaces/:wid/faq', async (req) =>
    inWorkspace(req, 'staff', async ({ q, wid }) => ({
      items: (await q.query('SELECT id, question, answer FROM faq_entries WHERE workspace_id = $1 ORDER BY created_at', [wid])).rows,
    })),
  );
  app.post('/api/v1/workspaces/:wid/faq', async (req) =>
    inWorkspace(req, 'admin', async ({ q, wid }) => {
      requireWriteAccess(await getAccess(q, wid, cfg));
      const body = parse(z.object({ question: zText(500, 1), answer: zText(2000, 1) }), req.body);
      const n = await q.query('SELECT count(*)::int AS n FROM faq_entries WHERE workspace_id = $1', [wid]);
      if (n.rows[0].n >= 100) throw new AppError('quota_exceeded', 'FAQ limit reached');
      return (
        await q.query('INSERT INTO faq_entries (workspace_id, question, answer) VALUES ($1, $2, $3) RETURNING id, question, answer', [
          wid,
          body.question,
          body.answer,
        ])
      ).rows[0];
    }),
  );
  app.delete('/api/v1/workspaces/:wid/faq/:fid', async (req) =>
    inWorkspace(req, 'admin', async ({ q, wid }) => {
      const { fid } = parse(z.object({ fid: zUuid }).passthrough(), req.params);
      await q.query('DELETE FROM faq_entries WHERE workspace_id = $1 AND id = $2', [wid, fid]);
      return { ok: true };
    }),
  );

  // ── AI ───────────────────────────────────────────────────────────────────
  async function aiContext(req: Parameters<typeof requireUser>[0] & { params: unknown }) {
    const user = await requireUser(req, s);
    const { wid } = parse(z.object({ wid: zUuid }).passthrough(), req.params);
    await requireRole(db.app, wid, user.id, 'staff');
    if (!(await isEnabled(db.app, 'ai.assistant', wid))) throw new AppError('feature_disabled', 'AI assistant is not enabled');
    return { workspaceId: wid, userId: user.id, locale: user.locale };
  }
  app.post('/api/v1/workspaces/:wid/ai/reply-suggestion', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const ctx = await aiContext(req);
    const body = parse(z.object({ customerMessage: zText(2000, 1) }), req.body);
    return suggestReply(db, s.ai, cfg, ctx, body.customerMessage);
  });
  app.post(
    '/api/v1/workspaces/:wid/ai/product-description',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const ctx = await aiContext(req);
      const body = parse(z.object({ name: zText(120, 1), notes: zText(1500), language: zLocale }), req.body);
      return draftProductDescription(db, s.ai, cfg, ctx, body);
    },
  );
  app.post('/api/v1/workspaces/:wid/ai/suggestions/:sid/review', async (req) =>
    inWorkspace(req, 'admin', async ({ q, wid, userId }) => {
      const { sid } = parse(z.object({ sid: zUuid }).passthrough(), req.params);
      const body = parse(z.object({ decision: z.enum(['approved', 'rejected']) }), req.body);
      await reviewSuggestion(q, wid, sid, body.decision);
      await audit(q, {
        action: `ai.suggestion_${body.decision}`,
        actorUserId: userId,
        workspaceId: wid,
        targetType: 'ai_request',
        targetId: sid,
      });
      return { ok: true };
    }),
  );

  // ── Billing ──────────────────────────────────────────────────────────────
  app.get('/api/v1/plans', async () => ({ items: await listPlans(db.app), providers: PAYMENT_PROVIDERS }));
  app.get('/api/v1/workspaces/:wid/billing', async (req) =>
    inWorkspace(req, 'admin', async ({ q, wid }) => ({ ...(await billingOverview(q, wid)), access: await getAccess(q, wid, cfg) })),
  );
  app.post('/api/v1/workspaces/:wid/billing/checkout', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req, s);
    const { wid } = parse(z.object({ wid: zUuid }).passthrough(), req.params);
    await requireRole(db.app, wid, user.id, 'admin');
    const body = parse(z.object({ plan: z.string().regex(/^[a-z0-9_]{2,32}$/) }), req.body);
    return createSubscriptionCheckout(db, s.gateway, { workspaceId: wid, userId: user.id, planCode: body.plan, locale: user.locale });
  });

  // ── Public storefront ────────────────────────────────────────────────────
  app.get('/api/v1/store/:slug', async (req) => {
    if (!(await isEnabled(db.app, 'store.public'))) throw new AppError('feature_disabled', 'Stores are unavailable');
    const { slug } = parse(z.object({ slug: z.string().max(40) }), req.params);
    const store = await resolvePublicStore(db, cfg, slug);
    const { id, ...pub } = store;
    return { store: pub, products: await publicCatalog(db, id) };
  });

  app.post('/api/v1/store/:slug/orders', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const user = await requireUser(req, s);
    if (!user.telegram_user_id) throw new AppError('forbidden', 'Telegram account required');
    const { slug } = parse(z.object({ slug: z.string().max(40) }), req.params);
    const body = parse(
      z.object({
        items: z
          .array(z.object({ variantId: zUuid, quantity: z.number().int().min(1).max(99) }))
          .min(1)
          .max(20),
        note: zText(500).optional(),
        idempotencyKey: zIdem,
      }),
      req.body,
    );
    const store = await resolvePublicStore(db, cfg, slug);
    const result = await db.tenant(store.id, async (q) => {
      const access = await getAccess(q, store.id, cfg);
      requireWriteAccess(access);
      if (access.limits.orders !== null && (await countOrders(q, store.id)) >= access.limits.orders) {
        throw new AppError('quota_exceeded', 'This store cannot accept more orders right now');
      }
      const customer = await upsertTelegramCustomer(q, store.id, { telegramUserId: user.telegram_user_id!, displayName: user.first_name });
      const firstOrder = (await countOrders(q, store.id)) === 0;
      const r = await createOrder(q, store.id, {
        items: body.items,
        customerId: customer.id,
        note: body.note,
        channel: 'telegram',
        idempotencyKey: `c_${user.id}_${body.idempotencyKey}`.slice(0, 128),
      });
      if (r.created) {
        await track(q, 'order_created', { workspaceId: store.id, props: { channel: 'telegram' } });
        if (firstOrder) await track(q, 'first_order', { workspaceId: store.id });
        const owner = await q.query('SELECT u.id FROM workspaces w JOIN users u ON u.id = w.owner_user_id WHERE w.id = $1', [store.id]);
        await enqueue(db.system, 'notify_user', {
          userId: owner.rows[0].id,
          key: 'bot.new_order',
          vars: { number: r.order.number, total: `${r.order.total_minor}`, currency: r.order.currency, customer: user.first_name },
          link: 'orders',
        });
      }
      return r;
    });
    const { order } = result;
    return {
      order: {
        id: order.id,
        number: order.number,
        status: order.status,
        total_minor: order.total_minor,
        currency: order.currency,
        items: order.items,
      },
      deliveryInfo: store.deliveryInfo,
      supportContact: store.supportContact,
    };
  });

  // ── Support ──────────────────────────────────────────────────────────────
  app.get('/api/v1/support/tickets', async (req) => {
    const user = await requireUser(req, s);
    return { items: await listTickets(db.app, user.id) };
  });
  app.post('/api/v1/support/tickets', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const user = await requireUser(req, s);
    const body = parse(
      z.object({
        category: z.enum(['technical', 'payment', 'account', 'other']),
        subject: zText(160, 1),
        body: zText(4000, 1),
        workspaceId: zUuid.optional(),
      }),
      req.body,
    );
    if (body.workspaceId) await requireRole(db.app, body.workspaceId, user.id, 'staff');
    return createTicket(db.app, { ...body, userId: user.id });
  });
  app.get('/api/v1/support/tickets/:id', async (req) => {
    const user = await requireUser(req, s);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    return getTicket(db.app, id, { userId: user.id, asStaff: false });
  });
  app.post('/api/v1/support/tickets/:id/messages', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const user = await requireUser(req, s);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const body = parse(z.object({ body: zText(4000, 1) }), req.body);
    await addTicketMessage(db.app, id, { userId: user.id, asStaff: false }, body.body);
    return { ok: true };
  });

  // ── Account (privacy) ────────────────────────────────────────────────────
  app.get('/api/v1/account/export', { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (req) => {
    const user = await requireUser(req, s);
    return exportUserData(db.app, user.id);
  });
  app.post('/api/v1/account/deletion', async (req) => {
    const user = await requireUser(req, s);
    const r = await requestDeletion(db.system, user.id);
    await audit(db.app, { action: 'account.deletion_requested', actorUserId: user.id });
    return r;
  });
  app.delete('/api/v1/account/deletion', async (req) => {
    const user = await requireUser(req, s);
    await cancelDeletion(db.system, user.id);
    return { ok: true };
  });

  // ── Integrations status (honest) ─────────────────────────────────────────
  app.get('/api/v1/integrations', async () => ({
    channels: CHANNELS,
    payments: PAYMENT_PROVIDERS,
    domains: DOMAIN_PROVIDERS,
    ai: { provider: s.ai.id, configured: s.ai.configured },
  }));

  function storeLink(slug: string) {
    return cfg.TELEGRAM_BOT_USERNAME ? `https://t.me/${cfg.TELEGRAM_BOT_USERNAME}?start=store_${slug}` : null;
  }
}

export function publicUser(u: { id: string; first_name: string; username: string | null; locale: string; platform_role: string }) {
  return { id: u.id, firstName: u.first_name, username: u.username, locale: u.locale, platformRole: u.platform_role };
}
