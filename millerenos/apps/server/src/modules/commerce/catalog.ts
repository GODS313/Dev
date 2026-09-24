import type { Queryable } from '../../db/pool.js';
import { AppError, notFound } from '../../lib/errors.js';

export interface ProductInput {
  name: string;
  description?: string;
  kind?: 'physical' | 'service' | 'digital';
  categoryId?: string | null;
  status?: 'draft' | 'active' | 'archived';
  priceMinor: number;
  stock?: number | null;
  sku?: string | null;
}

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.description, p.kind, p.status, p.category_id, p.created_at,
         coalesce(json_agg(json_build_object(
           'id', v.id, 'name', v.name, 'sku', v.sku, 'price_minor', v.price_minor::text,
           'stock', v.stock, 'is_active', v.is_active) ORDER BY v.created_at)
           FILTER (WHERE v.id IS NOT NULL), '[]') AS variants
    FROM products p LEFT JOIN product_variants v ON v.product_id = p.id AND v.workspace_id = p.workspace_id`;

export async function listProducts(q: Queryable, workspaceId: string, opts: { status?: string; limit?: number; cursor?: string } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const res = await q.query(
    `${PRODUCT_SELECT}
      WHERE p.workspace_id = $1 AND ($2::text IS NULL OR p.status = $2) AND ($3::timestamptz IS NULL OR p.created_at < $3)
      GROUP BY p.id ORDER BY p.created_at DESC LIMIT $4`,
    [workspaceId, opts.status ?? null, opts.cursor ?? null, limit + 1],
  );
  const rows = res.rows.slice(0, limit);
  const next = res.rows.length > limit ? rows[rows.length - 1]!.created_at.toISOString() : null;
  return { items: rows, nextCursor: next };
}

export async function getProduct(q: Queryable, workspaceId: string, id: string) {
  const res = await q.query(`${PRODUCT_SELECT} WHERE p.workspace_id = $1 AND p.id = $2 GROUP BY p.id`, [workspaceId, id]);
  if (!res.rows[0]) throw notFound('Product');
  return res.rows[0];
}

export async function countProducts(q: Queryable, workspaceId: string): Promise<number> {
  const res = await q.query(`SELECT count(*)::int AS n FROM products WHERE workspace_id = $1 AND status <> 'archived'`, [workspaceId]);
  return res.rows[0].n;
}

export async function createProduct(q: Queryable, workspaceId: string, input: ProductInput) {
  const p = await q.query(
    `INSERT INTO products (workspace_id, category_id, kind, name, description, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [workspaceId, input.categoryId ?? null, input.kind ?? 'physical', input.name, input.description ?? '', input.status ?? 'active'],
  );
  const id = p.rows[0].id as string;
  await q.query(
    `INSERT INTO product_variants (workspace_id, product_id, name, sku, price_minor, stock) VALUES ($1, $2, 'Default', $3, $4, $5)`,
    [workspaceId, id, input.sku ?? null, input.priceMinor, input.stock ?? null],
  );
  return getProduct(q, workspaceId, id);
}

export async function updateProduct(q: Queryable, workspaceId: string, id: string, input: Partial<ProductInput>) {
  const res = await q.query(
    `UPDATE products SET
        name = coalesce($3, name), description = coalesce($4, description), kind = coalesce($5, kind),
        status = coalesce($6, status),
        category_id = CASE WHEN $7::boolean THEN $8::uuid ELSE category_id END
      WHERE workspace_id = $1 AND id = $2 RETURNING id`,
    [
      workspaceId,
      id,
      input.name ?? null,
      input.description ?? null,
      input.kind ?? null,
      input.status ?? null,
      input.categoryId !== undefined,
      input.categoryId ?? null,
    ],
  );
  if (!res.rows[0]) throw notFound('Product');
  if (input.priceMinor !== undefined || input.stock !== undefined || input.sku !== undefined) {
    // Phase 1 products have a single default variant.
    await q.query(
      `UPDATE product_variants SET
          price_minor = coalesce($3, price_minor),
          stock = CASE WHEN $4::boolean THEN $5::int ELSE stock END,
          sku = CASE WHEN $6::boolean THEN $7 ELSE sku END
        WHERE workspace_id = $1 AND product_id = $2`,
      [
        workspaceId,
        id,
        input.priceMinor ?? null,
        input.stock !== undefined,
        input.stock ?? null,
        input.sku !== undefined,
        input.sku ?? null,
      ],
    );
  }
  return getProduct(q, workspaceId, id);
}

export async function listCategories(q: Queryable, workspaceId: string) {
  const res = await q.query('SELECT id, name, sort FROM categories WHERE workspace_id = $1 ORDER BY sort, name', [workspaceId]);
  return res.rows;
}

export async function createCategory(q: Queryable, workspaceId: string, name: string) {
  const res = await q.query('INSERT INTO categories (workspace_id, name) VALUES ($1, $2) RETURNING id, name, sort', [workspaceId, name]);
  return res.rows[0];
}

export async function assertCategory(q: Queryable, workspaceId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const res = await q.query('SELECT 1 FROM categories WHERE workspace_id = $1 AND id = $2', [workspaceId, categoryId]);
  if (!res.rows[0]) throw new AppError('validation_failed', 'Unknown category');
}
