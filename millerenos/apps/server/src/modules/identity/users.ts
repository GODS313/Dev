import type { Queryable } from '../../db/pool.js';
import type { TelegramUser } from './telegram-auth.js';

export interface UserRow {
  id: string;
  telegram_user_id: string | null;
  first_name: string;
  username: string | null;
  locale: 'en' | 'fa';
  locale_chosen: boolean;
  platform_role: 'user' | 'support' | 'admin' | 'superadmin';
  is_blocked: boolean;
  created_at: Date;
}

export const USER_COLUMNS =
  'id, telegram_user_id::text, first_name, username, locale, locale_chosen, platform_role, is_blocked, created_at';

export function guessLocale(languageCode?: string): 'en' | 'fa' {
  return languageCode?.toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

/**
 * Creates or refreshes a user from a verified Telegram identity.
 * Returns isNew so callers can emit bot_started / attribute referrals exactly once.
 */
export async function upsertTelegramUser(
  q: Queryable,
  tg: TelegramUser,
  adminIds: bigint[],
): Promise<{ user: UserRow; isNew: boolean }> {
  const firstName = (tg.first_name ?? '').slice(0, 128);
  const username = tg.username ? tg.username.slice(0, 64) : null;
  const isAdmin = adminIds.includes(BigInt(tg.id));
  const res = await q.query(
    `INSERT INTO users (telegram_user_id, first_name, username, locale, platform_role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (telegram_user_id) DO UPDATE
       SET first_name = EXCLUDED.first_name,
           username = EXCLUDED.username,
           platform_role = CASE WHEN $6 THEN 'superadmin' ELSE users.platform_role END
     RETURNING ${USER_COLUMNS}, (xmax = 0) AS inserted`,
    [tg.id, firstName, username, guessLocale(tg.language_code), isAdmin ? 'superadmin' : 'user', isAdmin],
  );
  const { inserted, ...user } = res.rows[0];
  return { user: user as UserRow, isNew: Boolean(inserted) };
}

export async function getUser(q: Queryable, id: string): Promise<UserRow | null> {
  const res = await q.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return res.rows[0] ?? null;
}

export async function setLocale(q: Queryable, userId: string, locale: 'en' | 'fa') {
  await q.query('UPDATE users SET locale = $2, locale_chosen = true WHERE id = $1', [userId, locale]);
}
