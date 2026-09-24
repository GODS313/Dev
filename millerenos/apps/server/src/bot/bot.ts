import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import { formatDuration, isLocale, t, type Locale } from '../i18n/index.js';
import { scrubSecrets, type Logger } from '../logger.js';
import { WindowLimiter } from '../lib/rate-limit.js';
import { AppError } from '../lib/errors.js';
import { track } from '../modules/analytics/track.js';
import { createSubscriptionCheckout, listPlans, recordSuccessfulPayment, validatePreCheckout } from '../modules/billing/billing.js';
import { GrammyGateway } from './gateway.js';
import { setLocale, upsertTelegramUser, type UserRow } from '../modules/identity/users.js';
import { getAccess, type Access } from '../modules/trial/access.js';
import { startTrial } from '../modules/trial/trials.js';
import { listUserWorkspaces, onboardingChecklist, getWorkspace } from '../modules/workspace/workspaces.js';
import { ensureReferralCode, attributeReferral } from '../modules/identity/referrals.js';
import { enqueue } from '../modules/jobs/queue.js';

export interface BotDeps {
  cfg: Config;
  db: Db;
  log: Logger;
  botInfo?: UserFromGetMe; // provided in tests to avoid a network getMe call
}

type Ctx = Context & { user?: UserRow; locale?: Locale };

/** Screens are selected with query params: Telegram puts its launch data in the URL hash. */
export function miniAppUrl(cfg: Config, path = '') {
  return `${cfg.PUBLIC_BASE_URL.replace(/\/$/, '')}/app/${path}`;
}

function statusLine(locale: Locale, access: Access) {
  if (access.state === 'trial') return t(locale, 'bot.status.trial', { left: formatDuration(locale, access.secondsLeft) });
  if (access.state === 'subscribed') return t(locale, 'bot.status.subscribed', { plan: access.plan });
  return t(locale, 'bot.status.expired');
}

const fmtDate = (d: Date, locale: Locale) => d.toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-GB', { timeZone: 'UTC' });

export function createBot(deps: BotDeps) {
  const { cfg, db, log } = deps;
  if (!cfg.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required to create the bot');
  const bot = new Bot<Ctx>(cfg.TELEGRAM_BOT_TOKEN, deps.botInfo ? { botInfo: deps.botInfo } : {});
  const gateway = new GrammyGateway(bot.api);
  const limiter = new WindowLimiter(30, 60_000);
  const secureWebApp = cfg.PUBLIC_BASE_URL.startsWith('https://');

  const mainMenu = (locale: Locale, hasWorkspace: boolean) => {
    const kb = new InlineKeyboard();
    if (secureWebApp) kb.webApp(t(locale, 'bot.btn.open_app'), miniAppUrl(cfg)).row();
    if (!hasWorkspace) kb.text(t(locale, 'bot.btn.start_trial'), 'trial:start').row();
    else kb.text(t(locale, 'bot.btn.my_business'), 'menu:business').text(t(locale, 'bot.btn.ai'), 'menu:ai').row();
    kb.text(t(locale, 'bot.btn.plans'), 'menu:plans').text(t(locale, 'bot.btn.support'), 'menu:support').row();
    kb.text(t(locale, 'bot.btn.invite'), 'menu:invite').text(t(locale, 'bot.btn.settings'), 'menu:settings');
    return kb;
  };
  const languageKeyboard = () => new InlineKeyboard().text('English', 'lang:en').text('فارسی', 'lang:fa');
  const backKeyboard = (locale: Locale) => new InlineKeyboard().text(t(locale, 'bot.btn.back'), 'menu:main');

  // ── middleware: per-user rate limit + identity ───────────────────────────────
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!from || from.is_bot) return;
    if (!limiter.allow(String(from.id))) return; // silently drop floods
    const { user, isNew } = await upsertTelegramUser(db.app, from, cfg.PLATFORM_ADMIN_TELEGRAM_IDS);
    if (user.is_blocked) {
      if (ctx.chat?.type === 'private') await ctx.reply(t(user.locale, 'bot.blocked'));
      return;
    }
    ctx.user = user;
    ctx.locale = user.locale;
    if (isNew) {
      const payload = ctx.message?.text?.startsWith('/start') ? ctx.message.text.split(' ')[1] ?? '' : '';
      const source = /^src_[a-z0-9_]{1,32}$/.test(payload) ? payload.slice(4) : payload.startsWith('ref_') ? 'referral' : 'direct';
      await track(db.app, 'bot_started', { userId: user.id, props: { source } });
      if (payload.startsWith('ref_')) await attributeReferral(db.app, user.id, payload.slice(4));
    }
    await next();
  });

  bot.chatType('private').command('start', async (ctx) => {
    const user = ctx.user!;
    const payload = ctx.match?.trim() ?? '';
    if (/^store_[a-z0-9-]{3,40}$/.test(payload) && secureWebApp) {
      const kb = new InlineKeyboard().webApp('🛍 Open store', miniAppUrl(cfg, `?store=${payload.slice(6)}`));
      await ctx.reply('🛍', { reply_markup: kb });
      return;
    }
    if (!user.locale_chosen) {
      await ctx.reply(t(user.locale, 'bot.choose_language'), { reply_markup: languageKeyboard() });
      return;
    }
    await sendMain(ctx);
  });

  async function sendMain(ctx: Ctx, edit = false) {
    const user = ctx.user!;
    const locale = ctx.locale!;
    const workspaces = await listUserWorkspaces(db, user.id);
    const text = workspaces.length
      ? t(locale, 'bot.welcome_back', { name: escapeHtml(user.first_name || '🙂') })
      : t(locale, 'bot.welcome');
    const opts = { parse_mode: 'HTML' as const, reply_markup: mainMenu(locale, workspaces.length > 0) };
    if (edit && ctx.callbackQuery) await ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
    else await ctx.reply(text, opts);
  }

  bot.callbackQuery(/^lang:(en|fa)$/, async (ctx) => {
    const locale = ctx.match[1] as Locale;
    await setLocale(db.app, ctx.user!.id, locale);
    ctx.user!.locale = locale;
    ctx.user!.locale_chosen = true;
    ctx.locale = locale;
    await track(db.app, 'language_selected', { userId: ctx.user!.id, props: { locale } });
    await ctx.answerCallbackQuery({ text: t(locale, 'bot.language_set') });
    await sendMain(ctx, true);
  });

  bot.callbackQuery('menu:main', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendMain(ctx, true);
  });

  bot.callbackQuery('trial:start', async (ctx) => {
    const locale = ctx.locale!;
    await ctx.answerCallbackQuery();
    const result = await startTrial(db, cfg, ctx.user!);
    if (!result.started) {
      await ctx.reply(t(locale, 'bot.trial_already_used'), { reply_markup: mainMenu(locale, Boolean(result.trial)) });
      return;
    }
    const kb = new InlineKeyboard();
    if (secureWebApp) kb.webApp(t(locale, 'bot.btn.open_app'), miniAppUrl(cfg)).row();
    kb.text(t(locale, 'bot.btn.back'), 'menu:main');
    await ctx.reply(t(locale, 'bot.trial_started', { minutes: formatDuration(locale, cfg.TRIAL_DURATION_MINUTES * 60) }), {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
  });

  bot.callbackQuery('menu:business', async (ctx) => {
    const locale = ctx.locale!;
    await ctx.answerCallbackQuery();
    const [ws] = await listUserWorkspaces(db, ctx.user!.id);
    if (!ws) {
      await ctx.reply(t(locale, 'bot.no_workspace'), { reply_markup: mainMenu(locale, false) });
      return;
    }
    const summary = await db.tenant(ws.id, async (q) => {
      const access = await getAccess(q, ws.id, cfg);
      const w = await getWorkspace(q, ws.id);
      const counts = await q.query(
        `SELECT (SELECT count(*)::int FROM products WHERE workspace_id = $1 AND status = 'active') AS products,
                (SELECT count(*)::int FROM orders WHERE workspace_id = $1) AS orders`,
        [ws.id],
      );
      return { access, w, counts: counts.rows[0], checklist: await onboardingChecklist(q, ws.id) };
    });
    const kb = new InlineKeyboard();
    if (secureWebApp) {
      kb.webApp(t(locale, 'bot.btn.products'), miniAppUrl(cfg, '?p=products'))
        .webApp(t(locale, 'bot.btn.orders'), miniAppUrl(cfg, '?p=orders'))
        .row();
    }
    if (summary.access.state === 'expired') kb.text(t(locale, 'bot.btn.plans'), 'menu:plans').row();
    kb.text(t(locale, 'bot.btn.back'), 'menu:main');
    await ctx.editMessageText(
      t(locale, 'bot.business_summary', {
        name: escapeHtml(summary.w.name),
        status: statusLine(locale, summary.access),
        products: summary.counts.products,
        orders: summary.counts.orders,
        done: summary.checklist.completed,
        total: summary.checklist.total,
      }),
      { parse_mode: 'HTML', reply_markup: kb },
    );
  });

  bot.callbackQuery('menu:plans', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendPlans(ctx, true);
  });
  bot.chatType('private').command('plans', (ctx) => sendPlans(ctx, false));

  async function sendPlans(ctx: Ctx, edit: boolean) {
    const locale = ctx.locale!;
    const plans = await listPlans(db.app);
    const lines = plans.map((p) =>
      t(locale, 'bot.plan_line', {
        plan: p.code,
        price: p.price_stars,
        days: p.period_days,
        products: p.limits.products ?? '—',
        ai: p.limits.ai_requests_per_day ?? 0,
      }),
    );
    const kb = new InlineKeyboard();
    for (const p of plans) kb.text(t(locale, 'bot.btn.buy_plan', { plan: p.code }), `plan:buy:${p.code}`).row();
    kb.text(t(locale, 'bot.btn.back'), 'menu:main');
    const text = `${t(locale, 'bot.plans_intro')}\n\n${lines.join('\n')}`;
    if (edit) await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    else await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }

  bot.callbackQuery(/^plan:buy:([a-z0-9_]{2,32})$/, async (ctx) => {
    const locale = ctx.locale!;
    await ctx.answerCallbackQuery();
    const owned = (await listUserWorkspaces(db, ctx.user!.id)).find((w) => w.role === 'owner' || w.role === 'admin');
    if (!owned) {
      await ctx.reply(t(locale, 'bot.no_workspace'), { reply_markup: mainMenu(locale, false) });
      return;
    }
    try {
      const { link } = await createSubscriptionCheckout(db, gateway, {
        workspaceId: owned.id,
        userId: ctx.user!.id,
        planCode: ctx.match[1]!,
        locale,
      });
      await ctx.reply('⭐', { reply_markup: new InlineKeyboard().url(t(locale, 'bot.btn.buy_plan', { plan: ctx.match[1]! }), link) });
    } catch (err) {
      if (err instanceof AppError) await ctx.reply(t(locale, 'bot.payments_unavailable'));
      else throw err;
    }
  });

  bot.on('pre_checkout_query', async (ctx) => {
    const q = ctx.preCheckoutQuery;
    const result = await validatePreCheckout(db, {
      payload: q.invoice_payload,
      currency: q.currency,
      totalAmount: q.total_amount,
      fromTelegramId: String(q.from.id),
    });
    if (result.ok) await ctx.answerPreCheckoutQuery(true);
    else await ctx.answerPreCheckoutQuery(false, { error_message: t(ctx.locale ?? 'en', 'bot.precheckout_failed') });
  });

  bot.on('message:successful_payment', async (ctx) => {
    const p = ctx.message.successful_payment;
    const locale = ctx.locale!;
    const outcome = await recordSuccessfulPayment(db, {
      payload: p.invoice_payload,
      currency: p.currency,
      totalAmount: p.total_amount,
      chargeId: p.telegram_payment_charge_id,
      fromTelegramId: String(ctx.from.id),
    });
    if (outcome.kind === 'activated') {
      await ctx.reply(t(locale, 'bot.payment_success', { plan: outcome.planCode, date: fmtDate(outcome.periodEnd, locale) }), { parse_mode: 'HTML' });
    } else if (outcome.kind === 'needs_review') {
      await ctx.reply(t(locale, 'bot.payment_review', { ref: p.telegram_payment_charge_id.slice(-10) }));
      for (const adminId of cfg.PLATFORM_ADMIN_TELEGRAM_IDS) {
        await enqueue(db.system, 'notify_user', { telegramUserId: adminId.toString(), raw: `⚠️ Payment needs review: ${outcome.reason}` });
      }
    }
  });

  bot.callbackQuery('menu:support', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendSimple(ctx, 'bot.support_intro', '?p=support', true);
  });
  bot.chatType('private').command('support', (ctx) => sendSimple(ctx, 'bot.support_intro', '?p=support', false));
  bot.callbackQuery('menu:ai', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendSimple(ctx, 'bot.ai_intro', '?p=ai', true);
  });

  async function sendSimple(ctx: Ctx, key: 'bot.support_intro' | 'bot.ai_intro', appPath: string, edit: boolean) {
    const locale = ctx.locale!;
    const kb = new InlineKeyboard();
    if (secureWebApp) kb.webApp(t(locale, 'bot.btn.open_app'), miniAppUrl(cfg, appPath)).row();
    kb.text(t(locale, 'bot.btn.back'), 'menu:main');
    if (edit) await ctx.editMessageText(t(locale, key), { parse_mode: 'HTML', reply_markup: kb });
    else await ctx.reply(t(locale, key), { parse_mode: 'HTML', reply_markup: kb });
  }

  bot.callbackQuery('menu:settings', async (ctx) => {
    const locale = ctx.locale!;
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard().text(t(locale, 'bot.btn.language'), 'menu:language').row().text(t(locale, 'bot.btn.back'), 'menu:main');
    await ctx.editMessageText(t(locale, 'bot.settings_intro'), { parse_mode: 'HTML', reply_markup: kb });
  });
  bot.callbackQuery('menu:language', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(ctx.locale!, 'bot.choose_language'), { reply_markup: languageKeyboard() });
  });
  bot.chatType('private').command('language', (ctx) => ctx.reply(t(ctx.locale!, 'bot.choose_language'), { reply_markup: languageKeyboard() }));

  bot.callbackQuery('menu:invite', async (ctx) => {
    const locale = ctx.locale!;
    await ctx.answerCallbackQuery();
    const code = await ensureReferralCode(db.app, ctx.user!.id);
    const link = `https://t.me/${bot.botInfo.username}?start=ref_${code}`;
    await ctx.editMessageText(t(locale, 'bot.invite_text', { link }), { reply_markup: backKeyboard(locale) });
  });

  bot.chatType('private').command('app', async (ctx) => {
    const locale = ctx.locale!;
    if (!secureWebApp) return void (await ctx.reply(t(locale, 'bot.error')));
    await ctx.reply('📱', { reply_markup: new InlineKeyboard().webApp(t(locale, 'bot.btn.open_app'), miniAppUrl(cfg)) });
  });
  bot.chatType('private').command('help', (ctx) => ctx.reply(t(ctx.locale!, 'bot.help')));
  bot.chatType('private').command('privacy', (ctx) =>
    ctx.reply(t(ctx.locale!, 'bot.privacy', { link: `${cfg.PUBLIC_BASE_URL}/${ctx.locale}/privacy` })),
  );

  bot.on('callback_query:data', (ctx) => ctx.answerCallbackQuery()); // stale buttons
  bot.chatType('private').on('message', async (ctx) => {
    const workspaces = await listUserWorkspaces(db, ctx.user!.id);
    await ctx.reply(t(ctx.locale!, 'bot.unknown'), { reply_markup: mainMenu(ctx.locale!, workspaces.length > 0) });
  });

  bot.catch(async (err) => {
    log.error({ err: scrubSecrets(String(err.error)), updateId: err.ctx.update.update_id }, 'bot handler failed');
    const locale = isLocale(err.ctx.locale) ? err.ctx.locale : 'en';
    if (err.ctx.chat?.type === 'private') await err.ctx.reply(t(locale, 'bot.error')).catch(() => undefined);
  });

  return { bot, gateway };
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
