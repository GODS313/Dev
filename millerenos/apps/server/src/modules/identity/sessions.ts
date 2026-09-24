import type { Queryable } from '../../db/pool.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { USER_COLUMNS, type UserRow } from './users.js';

/** Opaque bearer token; only its SHA-256 hash is stored, so a DB leak does not leak sessions. */
export async function createSession(q: Queryable, userId: string, ttlHours: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const res = await q.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3)) RETURNING expires_at`,
    [userId, sha256(token), ttlHours],
  );
  return { token, expiresAt: res.rows[0].expires_at };
}

export async function resolveSession(q: Queryable, token: string): Promise<UserRow | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const res = await q.query(
    `SELECT ${USER_COLUMNS.split(', ').map((c) => 'u.' + c).join(', ')}
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`,
    [sha256(token)],
  );
  return res.rows[0] ?? null;
}

export async function revokeSession(q: Queryable, token: string) {
  await q.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
}

export async function revokeAllSessions(q: Queryable, userId: string) {
  await q.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}
