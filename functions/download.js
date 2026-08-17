const DEFAULT_RELEASE = 'https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk';

export async function onRequestGet({ env }) {
  if (!env?.DB) return Response.redirect(DEFAULT_RELEASE, 302);
  try {
    const res = await env.DB.prepare('SELECT value FROM bot_settings WHERE key = ?').bind('download_source').all();
    const rows = (res && res.results) ? res.results : [];
    const url = rows[0] && rows[0].value ? rows[0].value : DEFAULT_RELEASE;
    if (!url || !url.startsWith('https://')) return Response.redirect(DEFAULT_RELEASE, 302);
    return Response.redirect(url, 302);
  } catch (e) {
    return Response.redirect(DEFAULT_RELEASE, 302);
  }
}
