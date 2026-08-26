import { json, requireAdmin } from '../../_lib/security.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB || !env.ADMIN_PASSWORD) return json({ error: 'تنظیمات Cloudflare کامل نیست' }, 503);
  if (!requireAdmin(request, env)) return json({ error: 'دسترسی غیرمجاز' }, 401);
  try {
    const [totalRow, todayRow] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM registrations').first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM registrations WHERE created_at >= strftime('%Y-%m-%d 00:00:00','now')").first(),
    ]);
    return json({ total: totalRow?.n || 0, today: todayRow?.n || 0 });
  } catch (error) {
    console.error('stats failed', error instanceof Error ? error.name : 'unknown');
    return json({ total: 0, today: 0 });
  }
}
