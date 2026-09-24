import { loadConfig, type Config } from './config.js';
import type { Services } from './http/context.js';
import { t, formatDuration, isLocale } from './i18n/index.js';
import { formatMoney } from './lib/money.js';
import { createLogger, scrubSecrets } from './logger.js';
import { processDueDeletions } from './modules/account/account.js';
import { claim, complete, enqueue, fail, requeueStale, type ClaimedJob } from './modules/jobs/queue.js';
import { expireDueTrials } from './modules/trial/trials.js';
import { createServices } from './services.js';
import { miniAppUrl } from './bot/bot.js';
import type { MessageKey } from './i18n/index.js';

/** Executes one job. Exported for tests. */
export async function runJob(s: Services, job: ClaimedJob) {
  const { db, gateway, cfg } = s;
  switch (job.type) {
    case 'notify_user': {
      const p = job.payload as {
        userId?: string;
        telegramUserId?: string;
        key?: MessageKey;
        vars?: Record<string, string>;
        raw?: string;
        link?: string;
      };
      let chatId = p.telegramUserId ?? null;
      let locale: 'en' | 'fa' = 'en';
      if (p.userId) {
        const u = await db.system.query('SELECT telegram_user_id::text AS tg, locale FROM users WHERE id = $1 AND deleted_at IS NULL', [
          p.userId,
        ]);
        if (!u.rows[0]?.tg) return; // user gone — nothing to send
        chatId = u.rows[0].tg;
        locale = isLocale(u.rows[0].locale) ? u.rows[0].locale : 'en';
      }
      if (!chatId || !gateway.configured) return;
      const vars = { ...(p.vars ?? {}) };
      if (p.key === 'bot.new_order' && vars.total && vars.currency) vars.total = formatMoney(vars.total, vars.currency, locale);
      for (const k of Object.keys(vars)) vars[k] = String(vars[k]).replace(/[<>&]/g, ''); // HTML-safe
      const text = p.raw ?? (p.key ? t(locale, p.key, vars) : '');
      const buttons =
        p.link && cfg.PUBLIC_BASE_URL.startsWith('https://')
          ? [[{ text: t(locale, 'bot.btn.open_app'), webAppUrl: miniAppUrl(cfg, `?p=${p.link}`) }]]
          : undefined;
      await gateway.sendMessage(chatId, text, { buttons });
      return;
    }
    case 'expire_trials': {
      const expired = await db.systemTx((q) => expireDueTrials(q));
      for (const tr of expired) {
        await enqueue(
          db.system,
          'notify_user',
          { userId: tr.user_id, key: 'bot.trial_expired', link: 'plans' },
          { dedupeKey: `trial_expired:${tr.id}` },
        );
      }
      return;
    }
    case 'purge_sessions':
      await db.system.query(`DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'`);
      await db.system.query(`DELETE FROM jobs WHERE status = 'done' AND finished_at < now() - interval '14 days'`);
      return;
    case 'process_account_deletions':
      await db.systemTx((q) => processDueDeletions(q));
      return;
  }
}

/** Periodic schedule. dedupe keys make this safe with several worker replicas. */
async function schedule(s: Services) {
  const minute = new Date().toISOString().slice(0, 16);
  const hour = minute.slice(0, 13);
  await enqueue(s.db.system, 'expire_trials', {}, { dedupeKey: `expire_trials:${minute}` });
  await enqueue(s.db.system, 'purge_sessions', {}, { dedupeKey: `purge_sessions:${hour}` });
  await enqueue(s.db.system, 'process_account_deletions', {}, { dedupeKey: `deletions:${hour}` });
}

async function main(cfg: Config) {
  const log = createLogger(cfg.LOG_LEVEL);
  const s = await createServices(cfg, log);
  let stopping = false;
  process.on('SIGTERM', () => (stopping = true));
  process.on('SIGINT', () => (stopping = true));
  log.info({ trialMinutes: formatDuration('en', cfg.TRIAL_DURATION_MINUTES * 60) }, 'worker started');
  let lastSchedule = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastSchedule > 30_000) {
        await schedule(s);
        await requeueStale(s.db.system);
        lastSchedule = Date.now();
      }
      const jobs = await claim(s.db.system, 10);
      for (const job of jobs) {
        try {
          await runJob(s, job);
          await complete(s.db.system, job.id);
        } catch (err) {
          const msg = scrubSecrets(String((err as Error)?.message ?? err));
          log.warn({ jobId: job.id, type: job.type, attempts: job.attempts }, `job failed: ${msg}`);
          await fail(s.db.system, job, msg);
        }
      }
      if (!jobs.length) await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      log.error({ err: scrubSecrets(String(err)) }, 'worker loop error');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await s.db.close();
  log.info('worker stopped');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(loadConfig()).catch((err) => {
    console.error(scrubSecrets(String(err)));
    process.exit(1);
  });
}
