import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { login, loginWithTrial, makeHarness } from './helpers.js';

/** Security tests: tenant isolation (IDOR/BOLA), RLS defense in depth, admin surface. */
describe('tenant isolation', () => {
  let h: Awaited<ReturnType<typeof makeHarness>>;
  let a: Awaited<ReturnType<typeof loginWithTrial>>;
  let b: Awaited<ReturnType<typeof loginWithTrial>>;
  let productA: string;

  before(async () => {
    h = await makeHarness('iso');
    a = await loginWithTrial(h, 1001, 'Alpha');
    b = await loginWithTrial(h, 1002, 'Beta');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${a.workspaceId}/products`,
      headers: a.auth,
      payload: { name: 'Secret sauce', priceMinor: 1000, stock: 5 },
    });
    assert.equal(res.statusCode, 200, res.body);
    productA = res.json().id;
  });
  after(() => h.close());

  it('member B cannot read, list or modify workspace A (404, no existence leak)', async () => {
    for (const [method, url] of [
      ['GET', `/api/v1/workspaces/${a.workspaceId}`],
      ['GET', `/api/v1/workspaces/${a.workspaceId}/products`],
      ['GET', `/api/v1/workspaces/${a.workspaceId}/products/${productA}`],
      ['GET', `/api/v1/workspaces/${a.workspaceId}/orders`],
      ['GET', `/api/v1/workspaces/${a.workspaceId}/customers`],
      ['GET', `/api/v1/workspaces/${a.workspaceId}/billing`],
      ['PATCH', `/api/v1/workspaces/${a.workspaceId}`],
    ] as const) {
      const res = await h.app.inject({ method, url, headers: b.auth, payload: method === 'PATCH' ? { name: 'pwned' } : undefined });
      assert.equal(res.statusCode, 404, `${method} ${url} → ${res.statusCode}`);
    }
  });

  it('B cannot reach A’s product through B’s own workspace id (IDOR)', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/workspaces/${b.workspaceId}/products/${productA}`, headers: b.auth });
    assert.equal(res.statusCode, 404);
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${b.workspaceId}/products/${productA}`,
      headers: b.auth,
      payload: { priceMinor: 1 },
    });
    assert.equal(patch.statusCode, 404);
    const check = await h.app.inject({ method: 'GET', url: `/api/v1/workspaces/${a.workspaceId}/products/${productA}`, headers: a.auth });
    assert.equal(check.json().variants[0].price_minor, '1000');
  });

  it('B cannot attach A’s category to B’s product', async () => {
    const cat = await h.app.inject({ method: 'POST', url: `/api/v1/workspaces/${a.workspaceId}/categories`, headers: a.auth, payload: { name: 'A-cat' } });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${b.workspaceId}/products`,
      headers: b.auth,
      payload: { name: 'x', priceMinor: 1, categoryId: cat.json().id },
    });
    assert.equal(res.statusCode, 422);
  });

  it('RLS blocks cross-tenant reads and writes even if app code forgets a filter', async () => {
    const rows = await h.db.tenant(b.workspaceId, (q) => q.query('SELECT id FROM products'));
    assert.equal(rows.rows.length, 0, 'unfiltered query inside tenant B must not see A');
    await assert.rejects(
      h.db.tenant(b.workspaceId, (q) => q.query(`INSERT INTO products (workspace_id, name) VALUES ($1, 'evil')`, [a.workspaceId])),
      /row-level security/,
    );
    const upd = await h.db.tenant(b.workspaceId, (q) => q.query(`UPDATE products SET name = 'evil' WHERE id = $1`, [productA]));
    assert.equal(upd.rowCount, 0);
  });

  it('app role without tenant context sees no tenant rows and cannot touch platform tables', async () => {
    const r = await h.db.app.query('SELECT count(*)::int AS n FROM products');
    assert.equal(r.rows[0].n, 0);
    await assert.rejects(h.db.app.query('SELECT * FROM jobs'), /permission denied/);
    await assert.rejects(h.db.app.query('DELETE FROM audit_logs'), /permission denied/);
  });

  it('rejects malformed workspace ids', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/workspaces/not-a-uuid`, headers: a.auth });
    assert.equal(res.statusCode, 422);
  });

  it('requires authentication and rejects forged tokens', async () => {
    assert.equal((await h.app.inject({ method: 'GET', url: '/api/v1/me' })).statusCode, 401);
    const forged = await h.app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${'A'.repeat(43)}` } });
    assert.equal(forged.statusCode, 401);
  });

  it('logout revokes the session', async () => {
    const s = await login(h, 1003);
    assert.equal((await h.app.inject({ method: 'GET', url: '/api/v1/me', headers: s.auth })).statusCode, 200);
    await h.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: s.auth });
    assert.equal((await h.app.inject({ method: 'GET', url: '/api/v1/me', headers: s.auth })).statusCode, 401);
  });

  it('admin API is invisible to normal users and works for platform admins', async () => {
    assert.equal((await h.app.inject({ method: 'GET', url: '/api/admin/overview', headers: a.auth })).statusCode, 404);
    const admin = await login(h, 999); // listed in PLATFORM_ADMIN_TELEGRAM_IDS
    assert.equal(admin.user.platformRole, 'superadmin');
    const res = await h.app.inject({ method: 'GET', url: '/api/admin/overview', headers: admin.auth });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().counts.workspaces >= 2);
  });

  it('admin mutations are audited; blocked users lose their sessions', async () => {
    const admin = await login(h, 999);
    const victim = await login(h, 1004);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/admin/users/${victim.user.id}/block`,
      headers: admin.auth,
      payload: { blocked: true, reason: 'abuse test' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((await h.app.inject({ method: 'GET', url: '/api/v1/me', headers: victim.auth })).statusCode, 401);
    const audit = await h.app.inject({ method: 'GET', url: '/api/admin/audit?action=admin.user_blocked', headers: admin.auth });
    assert.equal(audit.json().items.length, 1);
  });

  it('support tickets are private to their owner', async () => {
    const t = await h.app.inject({
      method: 'POST',
      url: '/api/v1/support/tickets',
      headers: a.auth,
      payload: { category: 'technical', subject: 'Help', body: 'Something broke' },
    });
    assert.equal(t.statusCode, 200, t.body);
    assert.match(t.json().reference, /^MLR-[A-Z0-9]{6}$/);
    const other = await h.app.inject({ method: 'GET', url: `/api/v1/support/tickets/${t.json().id}`, headers: b.auth });
    assert.equal(other.statusCode, 404);
    const reply = await h.app.inject({ method: 'POST', url: `/api/v1/support/tickets/${t.json().id}/messages`, headers: b.auth, payload: { body: 'hi' } });
    assert.equal(reply.statusCode, 404);
  });
});
