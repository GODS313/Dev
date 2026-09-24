import type { Config } from '../../config.js';
import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

export interface Limits {
  products: number;
  orders: number | null; // null = unlimited
  ai_requests: number; // per window
  ai_window: 'trial' | 'day';
}

export type Access =
  | { state: 'subscribed'; plan: string; periodEnd: Date; limits: Limits }
  | { state: 'trial'; trialEndsAt: Date; secondsLeft: number; limits: Limits }
  | { state: 'expired'; trialEndedAt: Date | null; limits: Limits };

const READ_ONLY: Limits = { products: 0, orders: 0, ai_requests: 0, ai_window: 'day' };

export function trialLimits(cfg: Config): Limits {
  return { products: cfg.TRIAL_MAX_PRODUCTS, orders: cfg.TRIAL_MAX_ORDERS, ai_requests: cfg.TRIAL_AI_REQUESTS, ai_window: 'trial' };
}

/** Server-side source of truth for what a workspace may do right now. */
export async function getAccess(q: Queryable, workspaceId: string, cfg: Config, now = new Date()): Promise<Access> {
  const sub = await q.query(
    `SELECT s.plan_code, s.current_period_end, p.limits FROM subscriptions s JOIN plans p ON p.code = s.plan_code
      WHERE s.workspace_id = $1 AND s.status = 'active' AND s.current_period_end > $2
      ORDER BY s.current_period_end DESC LIMIT 1`,
    [workspaceId, now],
  );
  if (sub.rows[0]) {
    const l = sub.rows[0].limits as Record<string, number>;
    return {
      state: 'subscribed',
      plan: sub.rows[0].plan_code,
      periodEnd: sub.rows[0].current_period_end,
      limits: { products: l.products ?? 100, orders: null, ai_requests: l.ai_requests_per_day ?? 0, ai_window: 'day' },
    };
  }
  const trial = await q.query('SELECT expires_at FROM trials WHERE workspace_id = $1', [workspaceId]);
  const t = trial.rows[0];
  if (t && t.expires_at > now) {
    return {
      state: 'trial',
      trialEndsAt: t.expires_at,
      secondsLeft: Math.max(0, Math.floor((t.expires_at.getTime() - now.getTime()) / 1000)),
      limits: trialLimits(cfg),
    };
  }
  return { state: 'expired', trialEndedAt: t?.expires_at ?? null, limits: READ_ONLY };
}

/** Writes are blocked after trial expiry; data stays readable and exportable. */
export function requireWriteAccess(access: Access) {
  if (access.state === 'expired') {
    throw new AppError('access_expired', 'Your trial has ended. Choose a plan to continue — your data is kept.');
  }
}

/**
 * Atomically increments a usage counter unless it already reached `limit`.
 * Returns the new count, or throws quota_exceeded. Safe under concurrency (single UPSERT).
 */
export async function consumeQuota(q: Queryable, workspaceId: string, metric: string, limit: number, windowStart: Date) {
  if (limit <= 0) throw new AppError('quota_exceeded', 'Quota exceeded', { metric });
  const res = await q.query(
    `INSERT INTO usage_counters (workspace_id, metric, window_start, count) VALUES ($1, $2, $3, 1)
     ON CONFLICT (workspace_id, metric, window_start)
       DO UPDATE SET count = usage_counters.count + 1 WHERE usage_counters.count < $4
     RETURNING count`,
    [workspaceId, metric, windowStart, limit],
  );
  if (!res.rows[0]) throw new AppError('quota_exceeded', 'Quota exceeded', { metric, limit });
  return res.rows[0].count as number;
}

export function quotaWindow(access: Access, now = new Date()): Date {
  if (access.limits.ai_window === 'trial') return new Date(0); // whole trial is one window
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
