import { createHash } from 'node:crypto';
import type { Queryable } from '../../db/pool.js';

interface FlagRow {
  key: string;
  enabled: boolean;
  rollout_percent: number;
  allow_workspaces: string[];
}

let cache: { at: number; flags: Map<string, FlagRow> } | null = null;
const TTL_MS = 15_000;

export function clearFlagCache() {
  cache = null;
}

async function load(q: Queryable) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.flags;
  const res = await q.query('SELECT key, enabled, rollout_percent, allow_workspaces::text[] FROM feature_flags');
  cache = { at: Date.now(), flags: new Map(res.rows.map((r: FlagRow) => [r.key, r])) };
  return cache.flags;
}

/**
 * enabled=true → on for everyone. Otherwise on for allow-listed workspaces and a stable
 * rollout_percent bucket of workspaces. Unknown flags are off (safe default).
 */
export async function isEnabled(q: Queryable, key: string, workspaceId?: string): Promise<boolean> {
  const flag = (await load(q)).get(key);
  if (!flag) return false;
  if (flag.enabled) return true;
  if (!workspaceId) return false;
  if (flag.allow_workspaces.includes(workspaceId)) return true;
  if (flag.rollout_percent <= 0) return false;
  const bucket = createHash('sha256').update(`${key}:${workspaceId}`).digest().readUInt16BE(0) % 100;
  return bucket < flag.rollout_percent;
}
