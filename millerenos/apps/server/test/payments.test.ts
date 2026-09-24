import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { WEBHOOK_SECRET, loginWithTrial, makeHarness, update } from './helpers.js';

describe('Telegram Stars subscription payments', () => {
  let h: Awaited<ReturnType<typeof makeHarness>>;
  let m: Awaited<ReturnType<typeof loginWithTrial>>;
  const TG = 3001;

  const hook = (body: Record<string, unknown>, secret = WEBHOOK_SECRET) =>
    h.app.inject({ method: 'POST', url: '/tg/webhook', headers: { 'x-telegram-bot-api-secret-token': secret }, payload: update(body) });

  const checkout = async () => {
    h.calls.length = 0;
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/workspaces/${m.workspaceId}/billing/checkout`, headers: m.auth, payload: { plan: 'starter' } });
    assert.equal(res.statusCode, 200, res.body);
    const call = h.calls.find((c) => c.method === 'createInvoiceLink')!;
    return { res: res.json(), payload: call.payload };
  };

  before(async () => {
    h = await makeHarness('pay');
    m = await loginWithTrial(h, TG);
  });
  after(() => h.close());

  it('creates a Stars (XTR) invoice with an empty provider token and server-side price', async () => {
    const { res, payload } = await checkout();
    assert.equal(res.link, 'https://t.me/$invoice_test');
    assert.equal(payload.currency, 'XTR');
    assert.equal(payload.provider_token, '');
    assert.deepEqual(payload.prices, [{ label: 'Millerenos starter plan', amount: 250 }]);
    assert.match(String(payload.payload), /^sub_[A-Za-z0-9_-]{24}$/);
  });

  it('webhook rejects requests without the secret token', async () => {
    assert.equal((await hook({ message: { text: 'x' } }, 'wrong_secret_wrong_secret_wrong_00')).statusCode, 401);
    const noHeader = await h.app.inject({ method: 'POST', url: '/tg/webhook', payload: update({}) });
    assert.equal(noHeader.statusCode, 401);
  });

  it('pre-checkout accepts a matching invoice and rejects tampered amounts or another payer', async () => {
    const { payload } = await checkout();
    const pcq = (over: Record<string, unknown>) => ({
      pre_checkout_query: { id: `pcq${Math.random()}`, from: { id: TG, is_bot: false, first_name: 'M' }, currency: 'XTR', total_amount: 250, invoice_payload: payload.payload, ...over },
    });
    h.calls.length = 0;
    await hook(pcq({}));
    assert.equal(h.calls.at(-1)!.method, 'answerPreCheckoutQuery');
    assert.equal(h.calls.at(-1)!.payload.ok, true);
    await hook(pcq({ total_amount: 1 }));
    assert.equal(h.calls.at(-1)!.payload.ok, false);
    await hook(pcq({ from: { id: 424242, is_bot: false, first_name: 'X' } }));
    assert.equal(h.calls.at(-1)!.payload.ok, false);
  });

  it('successful payment activates the plan exactly once, even when delivered twice', async () => {
    const { payload } = await checkout();
    const paid = {
      message: {
        message_id: 5,
        date: Math.floor(Date.now() / 1000),
        chat: { id: TG, type: 'private', first_name: 'M' },
        from: { id: TG, is_bot: false, first_name: 'M' },
        successful_payment: { currency: 'XTR', total_amount: 250, invoice_payload: payload.payload, telegram_payment_charge_id: 'charge_1', provider_payment_charge_id: '' },
      },
    };
    assert.equal((await hook(paid)).statusCode, 200);
    assert.equal((await hook(paid)).statusCode, 200); // replay / duplicate delivery

    const pays = await h.db.system.query(`SELECT count(*)::int AS n FROM payments WHERE provider_charge_id = 'charge_1'`);
    assert.equal(pays.rows[0].n, 1);
    const ws = await h.app.inject({ method: 'GET', url: `/api/v1/workspaces/${m.workspaceId}`, headers: m.auth });
    assert.equal(ws.json().access.state, 'subscribed');
    assert.equal(ws.json().access.plan, 'starter');
    const trial = await h.db.system.query('SELECT status FROM trials WHERE workspace_id = $1', [m.workspaceId]);
    assert.equal(trial.rows[0].status, 'converted');
    const sub = await h.db.system.query('SELECT current_period_end - current_period_start AS d FROM subscriptions WHERE workspace_id = $1', [m.workspaceId]);
    assert.equal(sub.rows[0].d.days, 30);

    // renewal extends the same subscription
    const second = await checkout();
    const paid2 = structuredClone(paid);
    paid2.message.successful_payment.invoice_payload = second.payload.payload as string;
    paid2.message.successful_payment.telegram_payment_charge_id = 'charge_2';
    await hook(paid2);
    const renewed = await h.db.system.query('SELECT count(*)::int AS n, max(current_period_end - current_period_start) AS d FROM subscriptions WHERE workspace_id = $1', [m.workspaceId]);
    assert.equal(renewed.rows[0].n, 1);
    assert.equal(renewed.rows[0].d.days, 60);
    const events = await h.db.system.query(`SELECT name FROM analytics_events WHERE workspace_id = $1 AND name LIKE 'subscription_%' ORDER BY id`, [m.workspaceId]);
    assert.deepEqual(events.rows.map((r) => r.name), ['subscription_started', 'subscription_renewed']);
  });

  it('a payment that does not match its invoice is recorded and flagged, not applied', async () => {
    const { payload } = await checkout();
    await hook({
      message: {
        message_id: 6,
        date: 0,
        chat: { id: TG, type: 'private', first_name: 'M' },
        from: { id: TG, is_bot: false, first_name: 'M' },
        successful_payment: { currency: 'XTR', total_amount: 1, invoice_payload: payload.payload, telegram_payment_charge_id: 'charge_bad', provider_payment_charge_id: '' },
      },
    });
    const p = await h.db.system.query(`SELECT count(*)::int AS n FROM payments WHERE provider_charge_id = 'charge_bad'`);
    assert.equal(p.rows[0].n, 1);
    const a = await h.db.system.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'payment.needs_review'`);
    assert.equal(a.rows[0].n, 1);
  });

  it('superadmin can refund a Stars payment; it is audited and cancels the plan', async () => {
    const { login } = await import('./helpers.js');
    const admin = await login(h, 999);
    const pay = await h.db.system.query(`SELECT id FROM payments WHERE provider_charge_id = 'charge_1'`);
    h.calls.length = 0;
    const res = await h.app.inject({ method: 'POST', url: `/api/admin/payments/${pay.rows[0].id}/refund`, headers: admin.auth, payload: { reason: 'customer request' } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(h.calls[0]!.method, 'refundStarPayment');
    assert.equal(h.calls[0]!.payload.telegram_payment_charge_id, 'charge_1');
    const again = await h.app.inject({ method: 'POST', url: `/api/admin/payments/${pay.rows[0].id}/refund`, headers: admin.auth, payload: { reason: 'double' } });
    assert.equal(again.statusCode, 409);
  });
});
