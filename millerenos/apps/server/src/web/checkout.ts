import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { basePath, type Config } from '../config.js';
import type { Db } from '../db/pool.js';
import type { Locale } from '../i18n/index.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { listPlans } from '../modules/billing/billing.js';
import { createCryptoInvoice, formatUnits6, type CryptoCurrency } from '../modules/billing/tron.js';
import { isEnabled } from '../modules/flags/flags.js';
import { createSession, resolveSession, revokeSession } from '../modules/identity/sessions.js';
import { validateLoginWidget } from '../modules/identity/telegram-auth.js';
import { upsertTelegramUser, type UserRow } from '../modules/identity/users.js';
import { listUserWorkspaces } from '../modules/workspace/workspaces.js';
import { esc } from './html.js';

/**
 * Website checkout for USDT (TRC-20) / TRX. Lives on the web, not in the bot or Mini App: Telegram requires Stars
 * for digital goods sold inside Telegram, and the bot does not link here.
 * Sign-in: official Telegram Login Widget → HttpOnly cookie session. Forms: CSRF token + Origin check.
 */
const COOKIE = 'mlr_web';

const T = {
  en: {
    title: 'Checkout',
    login: 'Sign in with your Telegram account to continue.',
    loginNote: 'You will sign in with the official Telegram login. We receive only your public name and id.',
    noWs: 'You don’t have a business workspace yet. Start your free trial in the Millerenos bot first.',
    plan: 'Plan',
    workspace: 'Workspace',
    currency: 'Pay with',
    create: 'Create payment',
    payTitle: 'Send the payment',
    sendExact: 'Send exactly',
    to: 'to this TRON address',
    network: 'Network: TRON (TRC-20). Sending on another network or a different amount cannot be matched automatically.',
    expires: 'This payment request expires at',
    waiting: 'Waiting for the transfer to be confirmed on the blockchain. This page refreshes automatically.',
    paid: 'Payment confirmed. Your plan is active — open Millerenos in Telegram.',
    void: 'This payment request has expired. Create a new one.',
    review: 'We received a transfer but it needs a manual check. Our team has been notified.',
    logout: 'Sign out',
    unavailable: 'Crypto checkout is not available yet.',
    perDays: (d: number) => `${d} days`,
  },
  fa: {
    title: 'پرداخت',
    login: 'برای ادامه با حساب تلگرام خود وارد شوید.',
    loginNote: 'ورود با سامانه رسمی تلگرام انجام می‌شود. فقط نام عمومی و شناسه شما دریافت می‌شود.',
    noWs: 'هنوز فضای کاری ندارید. ابتدا دوره رایگان را در ربات Millerenos شروع کنید.',
    plan: 'پلن',
    workspace: 'فضای کاری',
    currency: 'روش پرداخت',
    create: 'ایجاد درخواست پرداخت',
    payTitle: 'ارسال پرداخت',
    sendExact: 'دقیقاً این مقدار را ارسال کنید',
    to: 'به این آدرس ترون',
    network: 'شبکه: TRON (TRC-20). ارسال در شبکه دیگر یا با مقدار متفاوت به‌صورت خودکار شناسایی نمی‌شود.',
    expires: 'این درخواست منقضی می‌شود در',
    waiting: 'در انتظار تأیید تراکنش در بلاک‌چین. این صفحه خودکار به‌روز می‌شود.',
    paid: 'پرداخت تأیید شد. پلن شما فعال است — Millerenos را در تلگرام باز کنید.',
    void: 'این درخواست پرداخت منقضی شده است. یک درخواست جدید بسازید.',
    review: 'تراکنش دریافت شد اما نیاز به بررسی دستی دارد. تیم ما مطلع شده است.',
    logout: 'خروج',
    unavailable: 'پرداخت با رمزارز هنوز فعال نیست.',
    perDays: (d: number) => `${d.toLocaleString('fa-IR')} روز`,
  },
} as const;

type Layout = (
  locale: Locale,
  pageId: null,
  path: string,
  head: { title: string; description: string; noindex?: boolean },
  body: string,
) => string;

export function registerCheckout(app: FastifyInstance, deps: { cfg: Config; db: Db; layout: Layout }) {
  const { cfg, db, layout } = deps;
  const bp = basePath(cfg);
  const origin = new URL(cfg.PUBLIC_BASE_URL).origin;
  const secure = cfg.PUBLIC_BASE_URL.startsWith('https://');

  const csrfFor = (token: string) => createHmac('sha256', cfg.DATA_HASH_SECRET).update(`csrf:${token}`).digest('base64url');
  const cookieToken = (req: FastifyRequest) => {
    const m = (req.headers.cookie ?? '').match(/(?:^|;\s*)mlr_web=([A-Za-z0-9_-]{43})(?:;|$)/);
    return m?.[1] ?? null;
  };
  async function webUser(req: FastifyRequest): Promise<{ user: UserRow; token: string } | null> {
    const token = cookieToken(req);
    const user = token ? await resolveSession(db.app, token) : null;
    return user && !user.is_blocked ? { user, token: token! } : null;
  }
  const page = (reply: FastifyReply, locale: Locale, body: string, status = 200, refresh?: number) =>
    reply
      .code(status)
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex, nofollow')
      .send(
        layout(
          locale,
          null,
          'checkout',
          { title: `${T[locale].title} — Millerenos`, description: T[locale].title, noindex: true },
          body,
        ).replace('</head>', refresh ? `<meta http-equiv="refresh" content="${refresh}"></head>` : '</head>'),
      );
  const cryptoReady = async () =>
    Boolean(cfg.TRON_RECEIVE_ADDRESS && cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_BOT_USERNAME) && (await isEnabled(db.app, 'payments.tron'));

  // Telegram Login Widget redirect target
  app.get('/auth/telegram-web', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!cfg.TELEGRAM_BOT_TOKEN) throw new AppError('not_configured', 'Telegram sign-in is not configured');
    const q = req.query as Record<string, string>;
    const next = typeof q.next === 'string' ? q.next : '';
    const { next: _n, ...fields } = q;
    const tg = validateLoginWidget(fields, cfg.TELEGRAM_BOT_TOKEN, 86400);
    const { user } = await upsertTelegramUser(db.app, tg, cfg.PLATFORM_ADMIN_TELEGRAM_IDS);
    if (user.is_blocked) throw new AppError('forbidden', 'Account is blocked');
    const s = await createSession(db.app, user.id, cfg.SESSION_TTL_HOURS);
    reply.header(
      'set-cookie',
      `${COOKIE}=${s.token}; Path=${bp || '/'}; HttpOnly; SameSite=Lax; Max-Age=${cfg.SESSION_TTL_HOURS * 3600}${secure ? '; Secure' : ''}`,
    );
    // Open-redirect guard: only our own checkout pages.
    const safe = new RegExp(`^${bp.replace(/\//g, '\\/')}\\/(en|fa)\\/checkout(\\?plan=[a-z0-9_]{2,32})?$`).test(next)
      ? next
      : `${bp}/en/checkout`;
    return reply.redirect(safe, 303);
  });

  app.post('/auth/logout-web', async (req, reply) => {
    const token = cookieToken(req);
    const body = (req.body ?? {}) as Record<string, string>;
    if (token && typeof body.csrf === 'string' && safeEqual(body.csrf, csrfFor(token))) await revokeSession(db.app, token);
    reply.header('set-cookie', `${COOKIE}=; Path=${bp || '/'}; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
    return reply.redirect(`${bp}/en/pricing`, 303);
  });

  for (const locale of ['en', 'fa'] as const) {
    const L = T[locale];
    app.get(`/${locale}/checkout`, async (req, reply) => {
      if (!(await cryptoReady()))
        return page(reply, locale, `<section class="hero"><h1>${esc(L.title)}</h1><p class="lead">${esc(L.unavailable)}</p></section>`);
      const planParam = (req.query as Record<string, string>).plan;
      const who = await webUser(req);
      if (!who) {
        const next = `${bp}/${locale}/checkout${planParam && /^[a-z0-9_]{2,32}$/.test(planParam) ? `?plan=${planParam}` : ''}`;
        const authUrl = `${cfg.PUBLIC_BASE_URL}/auth/telegram-web?next=${encodeURIComponent(next)}`;
        return page(
          reply,
          locale,
          `<section class="hero"><h1>${esc(L.title)}</h1><p class="lead">${esc(L.login)}</p>
           <script async src="https://telegram.org/js/telegram-widget.js?22" data-telegram-login="${esc(cfg.TELEGRAM_BOT_USERNAME!)}"
             data-size="large" data-auth-url="${esc(authUrl)}" data-lang="${locale}"></script>
           <p class="muted">${esc(L.loginNote)}</p></section>`,
        );
      }
      const workspaces = (await listUserWorkspaces(db, who.user.id)).filter((w) => w.role === 'owner' || w.role === 'admin');
      if (!workspaces.length)
        return page(reply, locale, `<section class="hero"><h1>${esc(L.title)}</h1><p class="lead">${esc(L.noWs)}</p></section>`);
      const plans = (await listPlans(db.app)).filter((p) => p.price_usdt_micro || p.price_trx_sun);
      const opt = (v: string, label: string, sel: boolean) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
      return page(
        reply,
        locale,
        `<section class="hero"><h1>${esc(L.title)}</h1>
         <form method="post" action="${bp}/${locale}/checkout" class="card">
           <input type="hidden" name="csrf" value="${csrfFor(who.token)}">
           <p><label>${esc(L.workspace)}<br><select name="workspace">${workspaces.map((w, i) => opt(w.id, w.name, i === 0)).join('')}</select></label></p>
           <p><label>${esc(L.plan)}<br><select name="plan">${plans
             .map((p) =>
               opt(
                 p.code,
                 `${p.code} — ${p.price_usdt_micro ? `${formatUnits6(p.price_usdt_micro)} USDT` : ''}${p.price_trx_sun ? ` / ${formatUnits6(p.price_trx_sun)} TRX` : ''} · ${L.perDays(p.period_days)}`,
                 p.code === planParam,
               ),
             )
             .join('')}</select></label></p>
           <p><label>${esc(L.currency)}<br><select name="currency">${opt('USDT', 'USDT (TRC-20)', true)}${opt('TRX', 'TRX', false)}</select></label></p>
           <p><button class="btn" type="submit">${esc(L.create)}</button></p>
         </form>
         <form method="post" action="${bp}/auth/logout-web"><input type="hidden" name="csrf" value="${csrfFor(who.token)}"><button class="lang" type="submit">${esc(L.logout)}</button></form>
         </section>`,
      );
    });

    app.post(`/${locale}/checkout`, { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const who = await webUser(req);
      if (!who) return reply.redirect(`${bp}/${locale}/checkout`, 303);
      const body = z
        .object({
          csrf: z.string().max(100),
          workspace: z.uuid(),
          plan: z.string().regex(/^[a-z0-9_]{2,32}$/),
          currency: z.enum(['USDT', 'TRX']),
        })
        .safeParse(req.body);
      const originHeader = req.headers.origin;
      if (!body.success || !safeEqual(body.data.csrf, csrfFor(who.token)) || (originHeader && originHeader !== origin)) {
        throw new AppError('forbidden', 'Invalid form submission');
      }
      const role = (await listUserWorkspaces(db, who.user.id)).find((w) => w.id === body.data.workspace)?.role;
      if (role !== 'owner' && role !== 'admin') throw new AppError('not_found', 'Workspace not found');
      const inv = await createCryptoInvoice(db, cfg, {
        workspaceId: body.data.workspace,
        userId: who.user.id,
        planCode: body.data.plan,
        currency: body.data.currency as CryptoCurrency,
      });
      return reply.redirect(`${bp}/${locale}/pay/${inv.id}`, 303);
    });

    app.get(`/${locale}/pay/:id`, async (req, reply) => {
      const who = await webUser(req);
      if (!who) return reply.redirect(`${bp}/${locale}/checkout`, 303);
      const id = (req.params as { id: string }).id;
      if (!z.uuid().safeParse(id).success) throw new AppError('not_found', 'Not found');
      const res = await db.system.query(
        `SELECT id, provider, currency, amount_minor::text AS amount, status, pay_to, expires_at FROM invoices
          WHERE id = $1 AND payer_user_id = $2 AND provider IN ('tron_usdt', 'tron_trx')`,
        [id, who.user.id],
      );
      const inv = res.rows[0];
      if (!inv) throw new AppError('not_found', 'Not found');
      const flagged = inv.status === 'open' && (await db.system.query(`SELECT 1 FROM payments WHERE invoice_id = $1`, [id])).rows[0];
      let status: string;
      if (inv.status === 'paid') status = `<p class="badge ok">${esc(L.paid)}</p>`;
      else if (flagged) status = `<p class="badge no">${esc(L.review)}</p>`;
      else if (inv.status !== 'open')
        status = `<p class="badge no">${esc(L.void)}</p><p><a class="btn" href="${bp}/${locale}/checkout">${esc(L.create)}</a></p>`;
      else status = `<p class="muted">${esc(L.waiting)}</p>`;
      const when = new Date(inv.expires_at).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB', {
        timeZone: 'UTC',
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      return page(
        reply,
        locale,
        `<section class="hero"><h1>${esc(L.payTitle)}</h1>
         <div class="card">
           <p>${esc(L.sendExact)}:</p>
           <p class="price" dir="ltr">${esc(formatUnits6(inv.amount))} ${esc(inv.currency)}</p>
           <p>${esc(L.to)}:</p>
           <p dir="ltr"><code style="word-break:break-all;font-size:18px">${esc(inv.pay_to)}</code></p>
           <p class="muted">${esc(L.network)}</p>
           <p class="muted">${esc(L.expires)} ${esc(when)} (UTC)</p>
         </div>${status}</section>`,
        200,
        inv.status === 'open' && !flagged ? 30 : undefined,
      );
    });
  }
}
