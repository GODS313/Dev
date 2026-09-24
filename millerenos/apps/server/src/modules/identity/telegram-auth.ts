import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../lib/errors.js';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_bot?: boolean;
}

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: Date;
  startParam?: string;
}

/**
 * Validates Telegram Mini App init data on the server
 * (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * Client-provided identity is never trusted without this check.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
  now: Date = new Date(),
): ValidatedInitData {
  if (typeof initData !== 'string' || initData.length === 0 || initData.length > 4096) {
    throw new AppError('unauthorized', 'Invalid init data');
  }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new AppError('unauthorized', 'Invalid init data');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new AppError('unauthorized', 'Invalid init data signature');
  }

  const authDateSec = Number(params.get('auth_date'));
  if (!Number.isFinite(authDateSec) || authDateSec <= 0) throw new AppError('unauthorized', 'Invalid init data');
  const ageSec = now.getTime() / 1000 - authDateSec;
  if (ageSec > maxAgeSeconds || ageSec < -60) throw new AppError('unauthorized', 'Init data expired');

  let user: TelegramUser;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    throw new AppError('unauthorized', 'Invalid init data');
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) throw new AppError('unauthorized', 'Invalid init data');
  if (user.is_bot) throw new AppError('forbidden', 'Bots cannot sign in');

  const startParam = params.get('start_param') ?? undefined;
  return { user, authDate: new Date(authDateSec * 1000), startParam };
}

/** Test helper / tooling: produces init data signed with the given token. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dcs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}
