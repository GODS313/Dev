import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import type { Logger } from '../logger.js';
import { AppError } from '../lib/errors.js';
import type { AiProvider } from '../modules/ai/provider.js';
import type { TelegramGateway } from '../modules/billing/gateway.js';
import { resolveSession } from '../modules/identity/sessions.js';
import type { UserRow } from '../modules/identity/users.js';

export interface Services {
  cfg: Config;
  db: Db;
  log: Logger;
  ai: AiProvider;
  gateway: TelegramGateway;
  /** Handles one Telegram update (grammY). Undefined when the bot token is not configured. */
  handleUpdate?: (update: unknown) => Promise<void>;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow;
  }
}

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

export async function requireUser(req: FastifyRequest, s: Services): Promise<UserRow> {
  if (req.user) return req.user;
  const token = bearer(req);
  const user = token ? await resolveSession(s.db.app, token) : null;
  if (!user) throw new AppError('unauthorized', 'Sign in required');
  if (user.is_blocked) throw new AppError('forbidden', 'Account is blocked');
  req.user = user;
  return user;
}

export function requirePlatformRole(user: UserRow, roles: UserRow['platform_role'][]) {
  if (!roles.includes(user.platform_role)) throw new AppError('not_found', 'Not found'); // don't reveal admin surface
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError('validation_failed', 'Invalid input', {
      issues: r.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

export const zUuid = z.uuid();
export const zText = (max: number, min = 0) => z.string().trim().min(min).max(max);
