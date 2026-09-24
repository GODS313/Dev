import type { Config } from '../../config.js';
import type { Db } from '../../db/pool.js';
import { AppError, notFound } from '../../lib/errors.js';
import { getAccess } from '../trial/access.js';

/**
 * Resolves a public store by slug. Only published, active stores whose owner currently has
 * access (trial or subscription) are visible; anything else looks like "not found".
 * Returns only public fields.
 */
export async function resolvePublicStore(db: Db, cfg: Config, slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) throw notFound('Store');
  const res = await db.system.query(
    `SELECT id, name, slug, currency, default_locale, store_settings FROM workspaces
      WHERE slug = $1 AND status = 'active' AND store_published`,
    [slug],
  );
  const ws = res.rows[0];
  if (!ws) throw notFound('Store');
  const access = await db.tenant(ws.id, (q) => getAccess(q, ws.id, cfg));
  if (access.state === 'expired') throw new AppError('not_found', 'Store is temporarily unavailable');
  const settings = (ws.store_settings ?? {}) as Record<string, unknown>;
  return {
    id: ws.id as string,
    name: ws.name as string,
    slug: ws.slug as string,
    currency: ws.currency as string,
    locale: ws.default_locale as string,
    tagline: typeof settings.tagline === 'string' ? settings.tagline : '',
    supportContact: typeof settings.support_contact === 'string' ? settings.support_contact : '',
    deliveryInfo: typeof settings.delivery_info === 'string' ? settings.delivery_info : '',
  };
}

export async function publicCatalog(db: Db, workspaceId: string) {
  return db.tenant(workspaceId, async (q) => {
    const res = await q.query(
      `SELECT p.id, p.name, p.description, p.kind,
              json_agg(json_build_object('id', v.id, 'name', v.name, 'price_minor', v.price_minor::text,
                       'in_stock', v.stock IS NULL OR v.stock > 0) ORDER BY v.created_at) AS variants
         FROM products p JOIN product_variants v ON v.product_id = p.id AND v.workspace_id = p.workspace_id AND v.is_active
        WHERE p.workspace_id = $1 AND p.status = 'active'
        GROUP BY p.id ORDER BY p.created_at DESC LIMIT 200`,
      [workspaceId],
    );
    return res.rows;
  });
}
