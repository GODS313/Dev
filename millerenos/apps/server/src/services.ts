import { BotError } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { createBot } from './bot/bot.js';
import type { Config } from './config.js';
import { createDb } from './db/pool.js';
import type { Services } from './http/context.js';
import type { Logger } from './logger.js';
import { createAiProvider } from './modules/ai/provider.js';
import { NullGateway } from './modules/billing/gateway.js';

/** Wires infrastructure into the Services bag used by HTTP routes and the worker. */
export async function createServices(cfg: Config, log: Logger, opts: { botInfo?: UserFromGetMe } = {}): Promise<Services & { bot?: ReturnType<typeof createBot>['bot'] }> {
  const db = createDb({ appUrl: cfg.DATABASE_URL, systemUrl: cfg.DATABASE_SYSTEM_URL, max: cfg.DATABASE_POOL_MAX });
  const ai = createAiProvider(cfg);
  if (!cfg.TELEGRAM_BOT_TOKEN) {
    log.warn('TELEGRAM_BOT_TOKEN not set: bot, Mini App sign-in and payments are disabled');
    return { cfg, db, log, ai, gateway: new NullGateway() };
  }
  const { bot, gateway } = createBot({ cfg, db, log, botInfo: opts.botInfo });
  if (!opts.botInfo) await bot.init(); // getMe
  const handleUpdate = async (update: unknown) => {
    try {
      await bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0]);
    } catch (err) {
      if (err instanceof BotError) await bot.errorHandler(err); // user-facing error message + log
      throw err;
    }
  };
  return { cfg, db, log, ai, gateway, handleUpdate, bot };
}
