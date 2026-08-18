const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

const PUBLIC_DOWNLOAD_URL = 'https://adlisho.online/download';

const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

async function encryptionKey(env) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.CONFIG_ENCRYPTION_KEY));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt']);
}

async function encrypt(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(env),
    new TextEncoder().encode(value),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(ciphertext)}`;
}

function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS bot_settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    secret INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

async function settingsMap(db) {
  const result = await db.prepare('SELECT key,value FROM bot_settings').all();
  return Object.fromEntries((result.results || []).map((row) => [row.key, row.value]));
}

export async function onRequest({ request, env }) {
  if (!env.DB || !env.CONFIG_ENCRYPTION_KEY || !env.ADMIN_PASSWORD) {
    return json({ error: 'تنظیمات Cloudflare کامل نیست' }, 503);
  }
  if (!constantTimeEqual(request.headers.get('X-Admin-Key') || '', env.ADMIN_PASSWORD || '')) {
    return json({ error: 'دسترسی غیرمجاز' }, 401);
  }

  await ensureTable(env.DB);
  if (request.method === 'GET') {
    const current = await settingsMap(env.DB);
    return json({
      telegram_token_set: Boolean(current.telegram_token),
      bale_token_set: Boolean(current.bale_token),
      telegram_chat_id: current.telegram_chat_id || '',
      bale_chat_id: current.bale_chat_id || '',
      download_source: PUBLIC_DOWNLOAD_URL,
      revision: current.config_revision || '',
    });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'داده نامعتبر' }, 400); }
  if (!body || Array.isArray(body) || typeof body !== 'object') return json({ error: 'داده نامعتبر' }, 400);

  const updates = [];
  for (const name of ['telegram_chat_id', 'bale_chat_id']) {
    if (!Object.hasOwn(body, name)) continue;
    const value = String(body[name]).trim();
    if (!/^-?\d{4,20}$/.test(value)) return json({ error: 'Chat ID نامعتبر' }, 400);
    updates.push([name, value, 0]);
  }
  for (const name of ['telegram_token', 'bale_token']) {
    if (!Object.hasOwn(body, name)) continue;
    const value = String(body[name]).trim();
    if (!value) continue;
    if (!/^[A-Za-z0-9_:.-]{20,256}$/.test(value)) return json({ error: 'توکن نامعتبر' }, 400);
    updates.push([name, await encrypt(value, env), 1]);
  }
  if (Object.hasOwn(body, 'download_source') && String(body.download_source).trim() !== PUBLIC_DOWNLOAD_URL) {
    return json({ error: 'منبع دانلود فقط مخزن مستقیم و تأییدشده سرور است' }, 400);
  }
  updates.push(['download_source', PUBLIC_DOWNLOAD_URL, 0]);
  if (!updates.length) return json({ ok: true, changed: false });

  const revision = crypto.randomUUID();
  updates.push(['config_revision', revision, 0]);
  const statements = updates.map(([name, value, secret]) => env.DB.prepare(
    `INSERT INTO bot_settings(key,value,secret,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,secret=excluded.secret,updated_at=CURRENT_TIMESTAMP`,
  ).bind(name, value, secret));

  // D1 batch commits every setting and the revision as one transaction.
  await env.DB.batch(statements);
  return json({ ok: true, changed: true, revision });
}
