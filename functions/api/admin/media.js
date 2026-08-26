import { json, requireAdmin } from '../../_lib/security.js';
import { DEFAULT_CONTENT, sanitizeContent } from '../../_lib/content.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per image, plenty for a logo/icon/screenshot.
const SLOTS = new Set(['logo', 'icon']); // single-instance images; 'screenshot' is multi.
const MAX_SCREENSHOTS = 6;

const EXT_BY_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function sniffType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS media_assets(
    id TEXT PRIMARY KEY,
    slot TEXT,
    kind TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    label TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

async function detachFromContent(db, mediaId) {
  const row = await db.prepare(`SELECT value FROM site_content WHERE key = 'download_page'`).first();
  if (!row) return;
  let content;
  try { content = sanitizeContent(JSON.parse(row.value), DEFAULT_CONTENT); } catch { return; }
  let changed = false;
  for (const field of ['logo_media_id', 'icon_media_id']) {
    if (content[field] === mediaId) { content[field] = ''; changed = true; }
  }
  const filtered = content.screenshot_media_ids.filter((id) => id !== mediaId);
  if (filtered.length !== content.screenshot_media_ids.length) { content.screenshot_media_ids = filtered; changed = true; }
  if (!changed) return;
  const revision = crypto.randomUUID();
  await db.batch([
    db.prepare(`UPDATE site_content SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'download_page'`).bind(JSON.stringify(content)),
    db.prepare(`INSERT INTO site_content(key,value,updated_at) VALUES('download_page_revision',?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(revision),
  ]);
}

export async function onRequest({ request, env }) {
  if (!env.DB || !env.MEDIA || !env.ADMIN_PASSWORD) return json({ error: 'تنظیمات Cloudflare کامل نیست' }, 503);
  if (!requireAdmin(request, env)) return json({ error: 'دسترسی غیرمجاز' }, 401);
  await ensureTable(env.DB);

  if (request.method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT id, slot, kind, content_type, byte_size, label, sort_order, created_at FROM media_assets ORDER BY kind, sort_order, created_at',
    ).all();
    return json({ items: result.results || [] });
  }

  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const id = (url.searchParams.get('id') || '').trim();
    if (!id) return json({ error: 'شناسهٔ فایل لازم است' }, 400);
    await env.MEDIA.delete(id).catch(() => {});
    await env.DB.prepare('DELETE FROM media_assets WHERE id = ?').bind(id).run();
    await detachFromContent(env.DB, id);
    return json({ ok: true });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const kind = (request.headers.get('X-Kind') || '').trim();
  if (!['logo', 'icon', 'screenshot'].includes(kind)) return json({ error: 'نوع تصویر نامعتبر است' }, 400);

  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_BYTES) return json({ error: 'حجم فایل بیشتر از ۵ مگابایت است' }, 413);

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) return json({ error: 'فایلی دریافت نشد' }, 400);
  if (buffer.byteLength > MAX_BYTES) return json({ error: 'حجم فایل بیشتر از ۵ مگابایت است' }, 413);

  const bytes = new Uint8Array(buffer);
  const contentType = sniffType(bytes);
  if (!contentType) return json({ error: 'فقط PNG، JPEG یا WebP پذیرفته می‌شود' }, 415);

  if (kind === 'screenshot') {
    const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM media_assets WHERE kind = 'screenshot'`).first();
    if ((countRow?.n || 0) >= MAX_SCREENSHOTS) {
      return json({ error: `حداکثر ${MAX_SCREENSHOTS} اسکرین‌شات مجاز است؛ یکی را حذف کنید` }, 409);
    }
  }

  const id = `${crypto.randomUUID()}.${EXT_BY_TYPE[contentType]}`;
  await env.MEDIA.put(id, bytes, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } });

  const slot = SLOTS.has(kind) ? kind : null;
  let sortOrder = 0;
  if (!slot) {
    const maxRow = await env.DB.prepare(`SELECT MAX(sort_order) AS m FROM media_assets WHERE kind = 'screenshot'`).first();
    sortOrder = (maxRow?.m ?? -1) + 1;
  }

  let previousId = null;
  if (slot) {
    const previous = await env.DB.prepare('SELECT id FROM media_assets WHERE slot = ?').bind(slot).first();
    previousId = previous ? previous.id : null;
  }

  await env.DB.batch([
    ...(previousId ? [env.DB.prepare('DELETE FROM media_assets WHERE id = ?').bind(previousId)] : []),
    env.DB.prepare(
      'INSERT INTO media_assets(id, slot, kind, content_type, byte_size, sort_order, created_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)',
    ).bind(id, slot, kind, contentType, bytes.byteLength, sortOrder),
  ]);
  if (previousId) await env.MEDIA.delete(previousId).catch(() => {});

  return json({ ok: true, id, url: `/media/${id}`, content_type: contentType, byte_size: bytes.byteLength });
}
