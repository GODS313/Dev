import { json, requireAdmin } from '../../_lib/security.js';
import { DEFAULT_CONTENT, sanitizeContent, withMediaUrls } from '../../_lib/content.js';

async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS site_content(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

async function readContent(db) {
  const [contentRow, revisionRow] = await Promise.all([
    db.prepare('SELECT value FROM site_content WHERE key = ?').bind('download_page').first(),
    db.prepare('SELECT value FROM site_content WHERE key = ?').bind('download_page_revision').first(),
  ]);
  let content = DEFAULT_CONTENT;
  if (contentRow) {
    try { content = sanitizeContent(JSON.parse(contentRow.value), DEFAULT_CONTENT); } catch { content = DEFAULT_CONTENT; }
  }
  return { content, revision: revisionRow ? revisionRow.value : '' };
}

export async function onRequest({ request, env }) {
  if (!env.DB || !env.ADMIN_PASSWORD) return json({ error: 'تنظیمات Cloudflare کامل نیست' }, 503);
  if (!requireAdmin(request, env)) return json({ error: 'دسترسی غیرمجاز' }, 401);
  await ensureTable(env.DB);

  if (request.method === 'GET') {
    const { content, revision } = await readContent(env.DB);
    return json({ content: withMediaUrls(content), revision });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'داده نامعتبر' }, 400); }

  const { content: previous } = await readContent(env.DB);
  let content;
  try {
    content = sanitizeContent(body, previous);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'داده نامعتبر' }, 400);
  }

  const revision = crypto.randomUUID();
  const value = JSON.stringify(content);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO site_content(key,value,updated_at) VALUES('download_page',?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(value),
    env.DB.prepare(`INSERT INTO site_content(key,value,updated_at) VALUES('download_page_revision',?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(revision),
  ]);

  return json({ ok: true, content: withMediaUrls(content), revision });
}
