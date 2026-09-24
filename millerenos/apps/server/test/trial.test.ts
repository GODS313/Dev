import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { processDueDeletions } from '../src/modules/account/account.js';
import { expireDueTrials, startTrial } from '../src/modules/trial/trials.js';
import { initDataFor, login, loginWithTrial, makeHarness } from './helpers.js';

describe('one-hour trial', () => {
  let h: Awaited<ReturnType<typeof makeHarness>>;
  before(async () => {
    h = await makeHarness('trial', { TRIAL_MAX_PRODUCTS: '2' });
  });
  after(() => h.close());

  it('starts once with a server-side 60 minute expiry and exposes access state', async () => {
    const s = await loginWithTrial(h, 2001);
    const ws = await h.app.inject({ method: 'GET', url: `/api/v1/workspaces/${s.workspaceId}`, headers: s.auth });
    const body = ws.json();
    assert.equal(body.access.state, 'trial');
    assert.ok(body.access.secondsLeft > 3500 && body.access.secondsLeft <= 3600, String(body.access.secondsLeft));
    assert.equal(body.role, 'owner');
    const again = await h.app.inject({ method: 'POST', url: '/api/v1/trial', headers: s.auth, payload: {} });
    assert.equal(again.statusCode, 409);
  });

  it('enforces product quota during trial', async () => {
    const s = await loginWithTrial(h, 2002);
    const mk = () =>
      h.app.inject({ method: 'POST', url: `/api/v1/workspaces/${s.workspaceId}/products`, headers: s.auth, payload: { name: 'P', priceMinor: 100 } });
    assert.equal((await mk()).statusCode, 200);
    assert.equal((await mk()).statusCode, 200);
    const third = await mk();
    assert.equal(third.statusCode, 429);
    assert.equal(third.json().error.code, 'quota_exceeded');
  });

  it('expiry blocks writes, keeps data readable and marks trial expired', async () => {
    const s = await loginWithTrial(h, 2003);
    await h.app.inject({ method: 'POST', url: `/api/v1/workspaces/${s.workspaceId}/products`, headers: s.auth, payload: { name: 'Kept', priceMinor: 5 } });
    await h.db.system.query(`UPDATE trials SET expires_at = now() - interval '1 second', started_at = now() - interval '1 hour' WHERE workspace_id = $1`, [s.workspaceId]);
    const expired = await h.db.systemTx((q) => expireDueTrials(q));
    assert.ok(expired.some((t) => t.workspace_id === s.workspaceId));

    const create = await h.app.inject({ method: 'POST', url: `/api/v1/workspaces/${s.workspaceId}/products`, headers: s.auth, payload: { name: 'New', priceMinor: 5 } });
    assert.equal(create.statusCode, 402);
    assert.equal(create.json().error.code, 'access_expired');
    const list = await h.app.inject({ method: 'GET', url: `/api/v1/workspaces/${s.workspaceId}/products`, headers: s.auth });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().items.length, 1, 'trial data must not be destroyed');
    const ws = await h.app.inject({ method: 'GET', url: `/api/v1/workspaces/${s.workspaceId}`, headers: s.auth });
    assert.equal(ws.json().access.state, 'expired');
  });

  it('concurrent trial starts create exactly one trial and one workspace', async () => {
    const s = await login(h, 2004);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => h.app.inject({ method: 'POST', url: '/api/v1/trial', headers: s.auth, payload: {} })),
    );
    assert.equal(results.filter((r) => r.statusCode === 200).length, 1, results.map((r) => r.statusCode).join(','));
    const ws = await h.db.system.query('SELECT count(*)::int AS n FROM workspaces WHERE owner_user_id = $1', [s.user.id]);
    assert.equal(ws.rows[0].n, 1);
  });

  it('a deleted and re-created Telegram account cannot farm a second trial', async () => {
    const s = await loginWithTrial(h, 2005);
    const del = await h.app.inject({ method: "POST", url: "/api/v1/account/deletion", headers: s.auth });
    assert.equal(del.statusCode, 200, del.body);
    await h.db.system.query(`UPDATE account_deletion_requests SET execute_after = now() WHERE user_id = $1`, [s.user.id]);
    assert.equal(await h.db.systemTx((q) => processDueDeletions(q)), 1);
    const again = await login(h, 2005);
    assert.notEqual(again.user.id, s.user.id);
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/trial', headers: again.auth, payload: {} });
    assert.equal(res.statusCode, 409);
  });

  it('blocked users cannot start trials', async () => {
    const s = await login(h, 2006);
    await h.db.system.query('UPDATE users SET is_blocked = true WHERE id = $1', [s.user.id]);
    const user = (await h.db.app.query(`SELECT id, first_name, locale, is_blocked, telegram_user_id::text FROM users WHERE id = $1`, [s.user.id])).rows[0];
    await assert.rejects(startTrial(h.db, h.cfg, user), /blocked/);
  });

  it('stale init data cannot be used to sign in', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: initDataFor({ id: 2007 }, Math.floor(Date.now() / 1000) - 7200) },
    });
    assert.equal(res.statusCode, 401);
  });
});
