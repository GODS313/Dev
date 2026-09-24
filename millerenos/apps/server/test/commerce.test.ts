import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { login, loginWithTrial, makeHarness } from './helpers.js';

describe('commerce: store, orders, pricing, stock', () => {
  let h: Awaited<ReturnType<typeof makeHarness>>;
  let m: Awaited<ReturnType<typeof loginWithTrial>>;
  let variantId: string;
  let serviceVariant: string;

  before(async () => {
    h = await makeHarness('shop');
    m = await loginWithTrial(h, 4001, 'Tea House');
    const p = await h.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${m.workspaceId}/products`,
      headers: m.auth,
      payload: { name: 'Green tea', priceMinor: 1250, stock: 3 },
    });
    variantId = p.json().variants[0].id;
    const s = await h.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${m.workspaceId}/products`,
      headers: m.auth,
      payload: { name: 'Tasting', kind: 'service', priceMinor: 5000 },
    });
    serviceVariant = s.json().variants[0].id;
  });
  after(() => h.close());

  it('unpublished stores are not visible', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/store/${m.slug}` });
    assert.equal(res.statusCode, 404);
  });

  it('publishing exposes only public fields', async () => {
    const pub = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${m.workspaceId}`,
      headers: m.auth,
      payload: { store_published: true, store_settings: { tagline: 'Fresh tea', delivery_info: 'Pickup only' } },
    });
    assert.equal(pub.statusCode, 200, pub.body);
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/store/${m.slug}` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.store.name, 'Tea House');
    assert.equal(body.store.id, undefined);
    assert.equal(body.products.length, 2);
    assert.equal(JSON.stringify(body).includes('owner_user_id'), false);
    assert.equal(JSON.stringify(body).includes('"stock"'), false, 'exact stock is not public');
  });

  it('rejects unknown fields on workspace update (mass assignment)', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${m.workspaceId}`,
      headers: m.auth,
      payload: { owner_user_id: '00000000-0000-0000-0000-000000000000' },
    });
    assert.equal(res.statusCode, 422);
  });

  it('customer order uses server-side prices, is idempotent and decrements stock', async () => {
    const c = await login(h, 4002, { first_name: 'Customer' });
    const place = () =>
      h.app.inject({
        method: 'POST',
        url: `/api/v1/store/${m.slug}/orders`,
        headers: c.auth,
        payload: {
          items: [
            { variantId, quantity: 2 },
            { variantId: serviceVariant, quantity: 1 },
          ],
          idempotencyKey: 'order-key-0001',
          priceMinor: 1,
        },
      });
    const r1 = await place();
    assert.equal(r1.statusCode, 200, r1.body);
    assert.equal(r1.json().order.total_minor, String(1250 * 2 + 5000));
    const r2 = await place();
    assert.equal(r2.json().order.id, r1.json().order.id, 'same idempotency key → same order');
    const stock = await h.db.system.query('SELECT stock FROM product_variants WHERE id = $1', [variantId]);
    assert.equal(stock.rows[0].stock, 1);
    const notify = await h.db.system.query(`SELECT payload FROM jobs WHERE type = 'notify_user'`);
    assert.equal(notify.rows.length, 1);
    assert.equal(notify.rows[0].payload.key, 'bot.new_order');
  });

  it('refuses orders exceeding stock and variants from other stores', async () => {
    const c = await login(h, 4003);
    const over = await h.app.inject({
      method: 'POST',
      url: `/api/v1/store/${m.slug}/orders`,
      headers: c.auth,
      payload: { items: [{ variantId, quantity: 5 }], idempotencyKey: 'order-key-0002' },
    });
    assert.equal(over.statusCode, 409);
    const other = await loginWithTrial(h, 4004, 'Other');
    const op = await h.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${other.workspaceId}/products`,
      headers: other.auth,
      payload: { name: 'Foreign', priceMinor: 1 },
    });
    const foreign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/store/${m.slug}/orders`,
      headers: c.auth,
      payload: { items: [{ variantId: op.json().variants[0].id, quantity: 1 }], idempotencyKey: 'order-key-0003' },
    });
    assert.equal(foreign.statusCode, 422);
  });

  it('concurrent orders cannot oversell the last unit', async () => {
    const buyers = await Promise.all([4010, 4011, 4012].map((id) => login(h, id)));
    const results = await Promise.all(
      buyers.map((b, i) =>
        h.app.inject({
          method: 'POST',
          url: `/api/v1/store/${m.slug}/orders`,
          headers: b.auth,
          payload: { items: [{ variantId, quantity: 1 }], idempotencyKey: `race-key-000${i}` },
        }),
      ),
    );
    assert.equal(results.filter((r) => r.statusCode === 200).length, 1, results.map((r) => r.statusCode).join(','));
    const stock = await h.db.system.query('SELECT stock FROM product_variants WHERE id = $1', [variantId]);
    assert.equal(stock.rows[0].stock, 0);
  });

  it('merchant sees orders and customers; status machine rejects invalid transitions', async () => {
    const list = await h.app.inject({ method: 'GET', url: `/api/v1/workspaces/${m.workspaceId}/orders`, headers: m.auth });
    const order = list.json().items.at(-1);
    assert.ok(order);
    const bad = await h.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${m.workspaceId}/orders/${order.id}/status`,
      headers: m.auth,
      payload: { status: 'refunded' },
    });
    assert.equal(bad.statusCode, 409);
    for (const status of ['confirmed', 'paid', 'fulfilled']) {
      const ok = await h.app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${m.workspaceId}/orders/${order.id}/status`,
        headers: m.auth,
        payload: { status },
      });
      assert.equal(ok.statusCode, 200, ok.body);
    }
    const customers = await h.app.inject({ method: 'GET', url: `/api/v1/workspaces/${m.workspaceId}/customers`, headers: m.auth });
    assert.ok(customers.json().items.length >= 2);
    const ws = await h.app.inject({ method: 'GET', url: `/api/v1/workspaces/${m.workspaceId}`, headers: m.auth });
    assert.equal(ws.json().onboarding.completed, 4);
    assert.equal(ws.json().storeLink, `https://t.me/millerenos_test_bot?start=store_${m.slug}`);
  });

  it('cancelling an order returns stock', async () => {
    const c = await login(h, 4020);
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${m.workspaceId}/products/${(await h.db.system.query('SELECT product_id FROM product_variants WHERE id=$1', [variantId])).rows[0].product_id}`,
      headers: m.auth,
      payload: { stock: 2 },
    });
    const r = await h.app.inject({
      method: 'POST',
      url: `/api/v1/store/${m.slug}/orders`,
      headers: c.auth,
      payload: { items: [{ variantId, quantity: 2 }], idempotencyKey: 'cancel-key-0001' },
    });
    assert.equal(r.statusCode, 200, r.body);
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${m.workspaceId}/orders/${r.json().order.id}/status`,
      headers: m.auth,
      payload: { status: 'cancelled' },
    });
    const stock = await h.db.system.query('SELECT stock FROM product_variants WHERE id = $1', [variantId]);
    assert.equal(stock.rows[0].stock, 2);
  });
});
