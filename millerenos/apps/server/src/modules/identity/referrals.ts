import type { Queryable } from '../../db/pool.js';
import { randomCode } from '../../lib/crypto.js';
import { track } from '../analytics/track.js';

export async function ensureReferralCode(q: Queryable, userId: string): Promise<string> {
  const existing = await q.query('SELECT code FROM referral_codes WHERE user_id = $1', [userId]);
  if (existing.rows[0]) return existing.rows[0].code;
  for (let i = 0; i < 5; i++) {
    const code = randomCode(8, 'abcdefghijkmnpqrstuvwxyz23456789');
    const res = await q.query('INSERT INTO referral_codes (code, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING code', [
      code,
      userId,
    ]);
    if (res.rows[0]) {
      await track(q, 'referral_created', { userId });
      return code;
    }
    const again = await q.query('SELECT code FROM referral_codes WHERE user_id = $1', [userId]);
    if (again.rows[0]) return again.rows[0].code;
  }
  throw new Error('could not allocate referral code');
}

/** Attributes a brand-new user to a referrer once. Self-referral is ignored. */
export async function attributeReferral(q: Queryable, newUserId: string, code: string) {
  if (!/^[a-z0-9]{6,16}$/.test(code)) return;
  const res = await q.query(
    `UPDATE users SET referred_by = r.user_id FROM referral_codes r
      WHERE r.code = $2 AND users.id = $1 AND users.referred_by IS NULL AND r.user_id <> $1
      RETURNING r.user_id`,
    [newUserId, code],
  );
  if (res.rows[0]) await track(q, 'referral_signup', { userId: newUserId });
}
