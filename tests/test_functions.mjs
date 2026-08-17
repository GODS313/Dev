import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function importSource(relativePath) {
  const source = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('duplicate registration never discloses the existing tracking code', async () => {
  const { onRequest } = await importSource('functions/api/register.js');
  const db = {
    prepare(sql) {
      const statement = {
        bind() { return statement; },
        async first() {
          if (sql.includes('COUNT(*)')) return { c: 0 };
          if (sql.includes('tracking_code')) return { tracking_code: 'SECRET1234' };
          return null;
        },
        async run() { throw new Error('duplicate path must not insert'); },
      };
      return statement;
    },
  };
  const request = new Request('https://adlisho.online/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://adlisho.online' },
    body: JSON.stringify({
      name: 'کاربر آزمایشی',
      phone: '09121234567',
      province: '01',
      answers: { q1: '1', q2: 'bachelor', q3: 'yes' },
    }),
  });
  const response = await onRequest({ request, env: { DB: db } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.existing, true);
  assert.equal('tracking' in body, false);
  assert.equal(JSON.stringify(body).includes('SECRET1234'), false);
});

test('registration rejects an untrusted browser origin', async () => {
  const { onRequest } = await importSource('functions/api/register.js');
  const request = new Request('https://adlisho.online/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: '{}',
  });
  const response = await onRequest({ request, env: {} });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('registration rejects an oversized streamed body before JSON parsing', async () => {
  const { onRequest } = await importSource('functions/api/register.js');
  const request = new Request('https://adlisho.online/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://adlisho.online' },
    body: JSON.stringify({ filler: 'x'.repeat(9000) }),
  });
  request.headers.delete('Content-Length');
  const response = await onRequest({ request, env: { DB: {} } });
  assert.equal(response.status, 413);
});

test('download gateway rejects a redirect before contacting a disallowed host', async () => {
  const { onRequestGet } = await importSource('functions/download.js');
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1/internal' },
    });
  };
  try {
    const response = await onRequestGet({ env: {} });
    assert.equal(response.status, 503);
    assert.deepEqual(calls, ['https://seskia.online/est/download']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('download gateway follows only allowlisted redirects and requires a bounded body', async () => {
  const { onRequestGet } = await importSource('functions/download.js');
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { Location: '/files/app.apk' } });
    }
    return new Response(new Uint8Array([80, 75, 3, 4]), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': '4',
      },
    });
  };
  try {
    const response = await onRequestGet({ env: {} });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      'https://seskia.online/est/download',
      'https://seskia.online/files/app.apk',
    ]);
    assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="hamkare.apk"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin config persists one revision with one atomic D1 batch', async () => {
  const { onRequest } = await importSource('functions/api/admin/config.js');
  let batchCalls = 0;
  let batchSize = 0;
  const db = {
    prepare() {
      const statement = {
        bind() { return statement; },
        async run() {},
        async all() { return { results: [] }; },
      };
      return statement;
    },
    async batch(statements) {
      batchCalls += 1;
      batchSize = statements.length;
      return [];
    },
  };
  const request = new Request('https://adlisho.online/api/admin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'admin-secret' },
    body: JSON.stringify({
      telegram_chat_id: '-1001234567890',
      download_source: 'https://seskia.online/est/download',
    }),
  });
  const response = await onRequest({
    request,
    env: {
      DB: db,
      ADMIN_PASSWORD: 'admin-secret',
      CONFIG_ENCRYPTION_KEY: 'encryption-secret',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(batchCalls, 1);
  assert.equal(batchSize, 3); // two settings plus config_revision
});

test('download gateway reads the canonical D1 download_source first', async () => {
  const { onRequestGet } = await importSource('functions/download.js');
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(new Uint8Array([80, 75, 3, 4]), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': '4',
      },
    });
  };
  const db = {
    prepare() {
      return { async all() { return { results: [{ key: 'download_source', value: 'https://seskia.online/new.apk' }] }; } };
    },
  };
  try {
    const response = await onRequestGet({ env: { DB: db } });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['https://seskia.online/new.apk']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('VPS sync endpoint requires its independent secret', async () => {
  const { onRequestGet } = await importSource('functions/api/admin/sync.js');
  const request = new Request('https://adlisho.online/api/admin/sync');
  const response = await onRequestGet({
    request,
    env: { DB: {}, CONFIG_ENCRYPTION_KEY: 'encryption-secret', VPS_SYNC_KEY: 'sync-secret' },
  });
  assert.equal(response.status, 401);
});
