import { randomUUID } from 'node:crypto';
import type { Db, Queryable } from '../../db/pool.js';
import { randomCode } from '../../lib/crypto.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';

export type Role = 'owner' | 'admin' | 'staff';
const ROLE_RANK: Record<Role, number> = { staff: 1, admin: 2, owner: 3 };

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  default_locale: 'en' | 'fa';
  currency: string;
  status: 'active' | 'suspended' | 'deleted';
  store_published: boolean;
  store_settings: Record<string, unknown>;
  ai_mode: 'MANUAL' | 'SUGGEST_ONLY' | 'APPROVAL_REQUIRED' | 'AUTO_ALLOWED';
  business_policies: string;
  created_at: Date;
}

const WS_COLUMNS =
  'id, name, slug, owner_user_id, default_locale, currency, status, store_published, store_settings, ai_mode, business_policies, created_at';

export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f'’]/g, '') // drop accents and apostrophes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${base.length >= 3 ? base : 'store'}-${randomCode(5, 'abcdefghijkmnpqrstuvwxyz23456789')}`;
}

export async function createWorkspace(
  db: Db,
  owner: { id: string },
  input: { name: string; locale: 'en' | 'fa'; currency?: string },
): Promise<WorkspaceRow> {
  const id = randomUUID();
  return db.tenant(id, async (q) => {
    const res = await q.query(
      `INSERT INTO workspaces (id, name, slug, owner_user_id, default_locale, currency)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${WS_COLUMNS}`,
      [id, input.name.trim().slice(0, 80) || 'My Business', slugify(input.name), owner.id, input.locale, input.currency ?? 'USD'],
    );
    await q.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, owner.id]);
    return res.rows[0];
  });
}

export async function getWorkspace(q: Queryable, id: string): Promise<WorkspaceRow> {
  const res = await q.query(`SELECT ${WS_COLUMNS} FROM workspaces WHERE id = $1`, [id]);
  if (!res.rows[0]) throw notFound('Workspace');
  return res.rows[0];
}

export async function getMembershipRole(q: Queryable, workspaceId: string, userId: string): Promise<Role | null> {
  const res = await q.query('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
  return res.rows[0]?.role ?? null;
}

/** Throws unless the user is a member with at least `min` role. Non-members get 404 (no existence leak). */
export async function requireRole(q: Queryable, workspaceId: string, userId: string, min: Role): Promise<Role> {
  const role = await getMembershipRole(q, workspaceId, userId);
  if (!role) throw notFound('Workspace');
  if (ROLE_RANK[role] < ROLE_RANK[min]) throw forbidden('Insufficient role');
  return role;
}

export async function listUserWorkspaces(db: Db, userId: string) {
  const res = await db.system.query(
    `SELECT w.id, w.name, w.slug, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND w.status <> 'deleted' ORDER BY m.created_at`,
    [userId],
  );
  return res.rows as { id: string; name: string; slug: string; role: Role }[];
}

export async function updateWorkspace(
  q: Queryable,
  id: string,
  patch: Partial<Pick<WorkspaceRow, 'name' | 'default_locale' | 'currency' | 'ai_mode' | 'business_policies' | 'store_published'>> & {
    store_settings?: Record<string, unknown>;
  },
): Promise<WorkspaceRow> {
  const sets: string[] = [];
  const vals: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    vals.push(k === 'store_settings' ? JSON.stringify(v) : v);
    sets.push(`${k} = $${vals.length}`); // keys come from the typed allow-list above, never from user input
  }
  if (!sets.length) return getWorkspace(q, id);
  const res = await q.query(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = $1 RETURNING ${WS_COLUMNS}`, vals);
  if (!res.rows[0]) throw notFound('Workspace');
  return res.rows[0];
}

export async function onboardingChecklist(q: Queryable, workspaceId: string) {
  const res = await q.query(
    `SELECT
       EXISTS (SELECT 1 FROM products WHERE workspace_id = $1 AND status = 'active') AS product_added,
       (SELECT store_published FROM workspaces WHERE id = $1) AS store_published,
       EXISTS (SELECT 1 FROM orders WHERE workspace_id = $1) AS first_order`,
    [workspaceId],
  );
  const r = res.rows[0];
  const steps = [
    { key: 'business_created', done: true },
    { key: 'product_added', done: Boolean(r.product_added) },
    { key: 'store_published', done: Boolean(r.store_published) },
    { key: 'first_order', done: Boolean(r.first_order) },
  ];
  return { steps, completed: steps.filter((s) => s.done).length, total: steps.length };
}

export function assertActive(ws: WorkspaceRow) {
  if (ws.status !== 'active') throw new AppError('forbidden', 'Workspace is not active');
}
