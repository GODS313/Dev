const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

const RELEASE_URL = 'https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk';
const CANONICAL_DOWNLOAD_URL = 'https://adlisho.online/download';

const base64ToBytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function decryptionKey(env) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.CONFIG_ENCRYPTION_KEY));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt']);
}

async function decrypt(value, env) {
  const [ivValue, ciphertextValue, extra] = String(value).split('.');
  if (!ivValue || !ciphertextValue || extra !== undefined) throw new Error('invalid ciphertext');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivValue) },
    await decryptionKey(env),
    base64ToBytes(ciphertextValue),
  );
  return new TextDecoder().decode(plaintext);
}

export async function onRequestGet({ request, env }) {
  if (!env.DB || !env.CONFIG_ENCRYPTION_KEY || !env.VPS_SYNC_KEY) return json({ error: 'sync is not configured' }, 503);
  if (!constantTimeEqual(request.headers.get('X-Sync-Key') || '', env.VPS_SYNC_KEY)) return json({ error: 'unauthorized' }, 401);
  try {
    const result = await env.DB.prepare('SELECT key,value FROM bot_settings').all();
    const current = Object.fromEntries((result.results || []).map((row) => [row.key, row.value]));
    const platform = async (name) => {
      const tokenValue = current[`${name}_token`];
      const chatId = current[`${name}_chat_id`] || '';
      if (!tokenValue || !chatId) return null;
      return { token: await decrypt(tokenValue, env), chat_id: chatId };
    };
    return json({
      revision: current.config_revision || '',
      canonical_download_url: CANONICAL_DOWNLOAD_URL,
      download_source: current.download_source || RELEASE_URL,
      telegram: await platform('telegram'),
      bale: await platform('bale'),
    });
  } catch (error) {
    console.error('admin sync failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'sync unavailable' }, 503);
  }
}
