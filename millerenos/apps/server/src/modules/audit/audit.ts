import type { Queryable } from '../../db/pool.js';

export async function audit(
  q: Queryable,
  entry: {
    action: string;
    actorUserId?: string | null;
    workspaceId?: string | null;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await q.query(
    `INSERT INTO audit_logs (workspace_id, actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.workspaceId ?? null,
      entry.actorUserId ?? null,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}
