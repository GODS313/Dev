import { json } from '../_lib/security.js';
import { DEFAULT_CONTENT, sanitizeContent, withMediaUrls } from '../_lib/content.js';

// Public, read-only. Everything stored under the download_page key is
// display content that is already rendered on /dl -- nothing secret lives
// here, so this endpoint needs no auth. The master bot and the download
// bots use it to stay in sync with whatever the admin panel last saved.
export async function onRequestGet({ env }) {
  if (!env.DB) return json({ content: withMediaUrls(DEFAULT_CONTENT), revision: '' });
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS site_content(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).run();
    const [contentRow, revisionRow] = await Promise.all([
      env.DB.prepare('SELECT value FROM site_content WHERE key = ?').bind('download_page').first(),
      env.DB.prepare('SELECT value FROM site_content WHERE key = ?').bind('download_page_revision').first(),
    ]);
    let content = DEFAULT_CONTENT;
    if (contentRow) {
      try { content = sanitizeContent(JSON.parse(contentRow.value), DEFAULT_CONTENT); } catch { content = DEFAULT_CONTENT; }
    }
    return json(
      { content: withMediaUrls(content), revision: revisionRow ? revisionRow.value : '' },
      200,
      { 'Cache-Control': 'public, max-age=30' },
    );
  } catch (error) {
    console.error('download-page fetch failed', error instanceof Error ? error.name : 'unknown');
    return json({ content: withMediaUrls(DEFAULT_CONTENT), revision: '' });
  }
}
