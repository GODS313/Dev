const DEFAULT_ORIGINS = new Set([
  'https://adlisho.online',
  'https://www.adlisho.online',
]);
const VALID_PROVINCES = new Set(
  Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, '0')),
);

function allowedOrigins(env) {
  const origins = new Set(DEFAULT_ORIGINS);
  for (const value of String(env.PUBLIC_ORIGINS || '').split(',')) {
    const origin = value.trim();
    try {
      const url = new URL(origin);
      if (url.protocol === 'https:' && url.origin === origin) origins.add(origin);
    } catch {
      // Ignore malformed environment values instead of widening CORS.
    }
  }
  return origins;
}

function json(body, status = 200, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJsonBody(request, maxBytes) {
  if (!request.body) throw new Error('invalid-json');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('body-too-large');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
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
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin',
          }
        : {},
    });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'روش درخواست مجاز نیست.' }, 405, corsOrigin);
  }
  if (!env.DB) {
    return json({ ok: false, error: 'سرویس ثبت‌نام هنوز پیکربندی نشده است.' }, 503, corsOrigin);
  }
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ ok: false, error: 'نوع داده نامعتبر است.' }, 415, corsOrigin);
  }
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > 8192) {
    return json({ ok: false, error: 'حجم درخواست بیش از حد مجاز است.' }, 413, corsOrigin);
  }
  let data;
  try {
    data = await readJsonBody(request, 8192);
  } catch (error) {
    if (error instanceof Error && error.message === 'body-too-large') {
      return json({ ok: false, error: 'حجم درخواست بیش از حد مجاز است.' }, 413, corsOrigin);
    }
    return json({ ok: false, error: 'داده ارسالی نامعتبر است.' }, 400, corsOrigin);
  }
  const name = String(data.name || '').trim().replace(/\s+/g, ' ');
  const phone = String(data.phone || '').replace(/\D/g, '');
  const province = String(data.province || '').trim();
  const answers = data.answers && typeof data.answers === 'object' ? data.answers : {};
  if (
    name.length < 3
    || name.length > 80
    || !/^[\p{L}\p{M} '\u200c’.-]+$/u.test(name)
  ) {
    return json({ ok: false, error: 'نام و نام خانوادگی معتبر وارد کنید.' }, 400, corsOrigin);
  }
  if (!/^09\d{9}$/.test(phone)) {
    return json({ ok: false, error: 'شماره موبایل معتبر نیست.' }, 400, corsOrigin);
  }
  if (!VALID_PROVINCES.has(province)) {
    return json({ ok: false, error: 'استان انتخاب‌شده معتبر نیست.' }, 400, corsOrigin);
  }
  if (
    !['0', '1', '3', '6'].includes(String(answers.q1))
    || !['diploma', 'bachelor', 'master'].includes(answers.q2)
    || !['yes', 'no'].includes(answers.q3)
  ) {
    return json({ ok: false, error: 'پاسخ‌های ارزیابی کامل نیست.' }, 400, corsOrigin);
  }
  const ip = (request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 64);
  try {
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) c FROM registrations WHERE ip=? AND created_at >= datetime('now','-1 hour')",
    ).bind(ip).first();
    if (Number(recent?.c || 0) >= 5) {
      return json({ ok: false, error: 'تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد تلاش کنید.' }, 429, corsOrigin);
    }
    const existing = await env.DB.prepare(
      'SELECT tracking_code FROM registrations WHERE phone=?',
    ).bind(phone).first();
    if (existing?.tracking_code) {
      return json({
        ok: true,
        existing: true,
        message: 'این شماره قبلاً ثبت شده است. برای بازیابی کد پیگیری با پشتیبانی تماس بگیرید.',
      }, 200, corsOrigin);
    }
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    let tracking = '';
    for (const byte of bytes) tracking += alphabet[byte % alphabet.length];
    const result = await env.DB.prepare(
      'INSERT INTO registrations (name,phone,province,answers,ip,tracking_code) VALUES (?,?,?,?,?,?)',
    ).bind(
      name,
      phone,
      province,
      JSON.stringify({ q1: String(answers.q1), q2: answers.q2, q3: answers.q3 }),
      ip,
      tracking,
    ).run();
    if (!result.success) throw new Error('insert failed');
    return json({ ok: true, tracking }, 201, corsOrigin);
  } catch (error) {
    console.error('registration error', error instanceof Error ? error.name : 'unknown');
    return json({ ok: false, error: 'ثبت درخواست موقتاً امکان‌پذیر نیست.' }, 500, corsOrigin);
  }
}
