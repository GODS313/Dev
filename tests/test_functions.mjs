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

test('download gateway always redirects to the official GitHub Release', async () => {
  const { onRequestGet } = await importSource('functions/download.js');
  const response = await onRequestGet({ env: {} });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk');
});

test('download gateway reads the current D1 download source', async () => {
  const { onRequestGet } = await importSource('functions/download.js');
  const statement = {
    bind() { return statement; },
    async all() { return { results: [{ value: 'https://cdn.example/hamkare.apk' }] }; },
  };
  const response = await onRequestGet({ env: { DB: { prepare() { return statement; } } } });
  assert.equal(response.headers.get('Location'), 'https://cdn.example/hamkare.apk');
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
      download_source: 'https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk',
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

test('VPS sync endpoint requires its independent secret', async () => {
  const { onRequestGet } = await importSource('functions/api/admin/sync.js');
  const request = new Request('https://adlisho.online/api/admin/sync');
  const response = await onRequestGet({
    request,
    env: { DB: {}, CONFIG_ENCRYPTION_KEY: 'encryption-secret', VPS_SYNC_KEY: 'sync-secret' },
  });
  assert.equal(response.status, 401);
});
