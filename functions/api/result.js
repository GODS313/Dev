const DEFAULT_ORIGINS = new Set([
  'https://adlisho.online',
  'https://www.adlisho.online',
]);

function allowedOrigins(env) {
  const origins = new Set(DEFAULT_ORIGINS);
  for (const value of String(env.PUBLIC_ORIGINS || '').split(',')) {
    const origin = value.trim();
    try {
      const url = new URL(origin);
      if (url.protocol === 'https:' && url.origin === origin) origins.add(origin);
    } catch {
      // Keep a closed allowlist when an environment value is malformed.
    }
  }
  return origins;
}

function json(body, status = 200, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

export async function onRequest({ request, env }) {
  const requestOrigin = request.headers.get('Origin') || '';
  const allowed = allowedOrigins(env);
  const corsOrigin = allowed.has(requestOrigin) ? requestOrigin : '';
  if (requestOrigin && !corsOrigin) {
    return json({ ok: false, error: 'مبدأ درخواست مجاز نیست.' }, 403);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsOrigin
        ? {
            'Access-Control-Allow-Origin': corsOrigin,
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin',
          }
        : {},
    });
  }
  if (request.method !== 'GET') {
    return json({ ok: false, error: 'روش درخواست مجاز نیست.' }, 405, corsOrigin);
  }
  if (!env.DB) {
    return json({ ok: false, error: 'سرویس پیگیری هنوز پیکربندی نشده است.' }, 503, corsOrigin);
  }
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') || '').trim().toUpperCase();
  const last4 = (url.searchParams.get('last4') || '').trim();
  if (!/^[A-Z0-9]{6,12}$/.test(code)) {
    return json({ ok: false, error: 'کد پیگیری نامعتبر است.' }, 400, corsOrigin);
  }
  if (!/^\d{4}$/.test(last4)) {
    return json({ ok: false, error: 'چهار رقم آخر موبایل را وارد کنید.' }, 400, corsOrigin);
  }
  try {
    const row = await env.DB.prepare(
      'SELECT name,province,phone,created_at,tracking_code FROM registrations WHERE tracking_code=?',
    ).bind(code).first();
    if (!row || String(row.phone).slice(-4) !== last4) {
      return json({ ok: false, error: 'کد پیگیری یا شماره موبایل صحیح نیست.' }, 404, corsOrigin);
    }
    return json({
      ok: true,
      record: {
        name: row.name,
        province: row.province,
        created_at: row.created_at,
        tracking_code: row.tracking_code,
      },
    }, 200, corsOrigin);
  } catch (error) {
    console.error('result error', error instanceof Error ? error.name : 'unknown');
    return json({ ok: false, error: 'دریافت وضعیت موقتاً امکان‌پذیر نیست.' }, 500, corsOrigin);
  }
}
