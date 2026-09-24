import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import {
  TronGridClient,
  USDT_TRC20_CONTRACT,
  processTronPayments,
  tronAddressToHex,
  type IncomingTransfer,
  type TronClient,
} from '../src/modules/billing/tron.js';
import { signLoginWidget } from '../src/modules/identity/telegram-auth.js';
import { BOT_TOKEN, loginWithTrial, makeHarness } from './helpers.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function tronAddress(seed: number) {
  const payload = Buffer.concat([Buffer.from([0x41]), createHash('sha256').update(String(seed)).digest().subarray(0, 20)]);
  const check = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  let n = BigInt('0x' + Buffer.concat([payload, check]).toString('hex'));
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}
const ADDRESS = tronAddress(1);

class FakeTron implements TronClient {
  usdt: IncomingTransfer[] = [];
  trx: IncomingTransfer[] = [];
  async incomingUsdt() {
    return this.usdt;
  }
  async incomingTrx() {
    return this.trx;
  }
}
const txid = (n: number) => createHash('sha256').update(`tx${n}`).digest('hex');

describe('TRON (USDT/TRX) website checkout', () => {
  let h: Awaited<ReturnType<typeof makeHarness>>;
  let m: Awaited<ReturnType<typeof loginWithTrial>>;
  let cookie: string;
  const tron = new FakeTron();

  const webLogin = async (id: number, next = '/en/checkout?plan=starter') => {
    const fields = signLoginWidget({ id: String(id), first_name: 'Web', auth_date: String(Math.floor(Date.now() / 1000)) }, BOT_TOKEN);
    const qs = new URLSearchParams({ ...fields, next });
    return h.app.inject({ method: 'GET', url: `/auth/telegram-web?${qs}` });
  };
  const csrfFrom = (html: string) => html.match(/name="csrf" value="([^"]+)"/)![1]!;
  const createInvoice = async (currency: 'USDT' | 'TRX', plan = 'starter') => {
    const page = await h.app.inject({ method: 'GET', url: '/en/checkout', headers: { cookie } });
    const res = await h.app.inject({
      method: 'POST',
      url: '/en/checkout',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ csrf: csrfFrom(page.body), workspace: m.workspaceId, plan, currency }).toString(),
    });
    assert.equal(res.statusCode, 303, res.body);
    const id = String(res.headers.location).split('/').pop()!;
    return (await h.db.system.query('SELECT id, amount_minor::text AS amount, expires_at FROM invoices WHERE id = $1', [id])).rows[0];
  };

  before(async () => {
    h = await makeHarness('crypto', { TRON_RECEIVE_ADDRESS: ADDRESS, LOG_LEVEL: 'error' });
    m = await loginWithTrial(h, 7001, 'Crypto shop');
  });
  after(() => h.close());

  it('validates TRON addresses with checksum', () => {
    assert.match(tronAddressToHex(ADDRESS), /^41[0-9a-f]{40}$/);
    assert.throws(() => tronAddressToHex(ADDRESS.slice(0, -1) + (ADDRESS.endsWith('A') ? 'B' : 'A')));
  });

  it('pricing page shows Stars, USDT and TRX prices', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/en/pricing' });
    assert.match(res.body, /250 ⭐/);
    assert.match(res.body, /or 5 USDT · 17 TRX \(TRON network\)/);
    assert.match(res.body, /href="\/en\/checkout\?plan=starter"/);
    const fa = await h.app.inject({ method: 'GET', url: '/fa/pricing' });
    assert.match(fa.body, /تتر/);
  });

  it('checkout requires Telegram login and allows the widget in CSP', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/en/checkout?plan=starter' });
    assert.match(res.body, /telegram-widget\.js/);
    assert.match(res.body, /data-telegram-login="millerenos_test_bot"/);
    assert.match(String(res.headers['content-security-policy']), /script-src https:\/\/telegram\.org/);
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
  });

  it('web login verifies the widget signature, sets a secure cookie and blocks open redirects', async () => {
    const bad = await h.app.inject({
      method: 'GET',
      url: `/auth/telegram-web?id=7001&auth_date=${Math.floor(Date.now() / 1000)}&hash=${'0'.repeat(64)}`,
    });
    assert.equal(bad.statusCode, 401);
    const evil = await webLogin(7001, 'https://evil.example/phish');
    assert.equal(evil.headers.location, '/en/checkout');
    const ok = await webLogin(7001);
    assert.equal(ok.statusCode, 303);
    assert.equal(ok.headers.location, '/en/checkout?plan=starter');
    const setCookie = String(ok.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Secure/);
    cookie = setCookie.split(';')[0]!;
  });

  it('rejects form posts without a valid CSRF token or from another origin', async () => {
    const noCsrf = await h.app.inject({
      method: 'POST',
      url: '/en/checkout',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `csrf=x&workspace=${m.workspaceId}&plan=starter&currency=USDT`,
    });
    assert.equal(noCsrf.statusCode, 403);
    const page = await h.app.inject({ method: 'GET', url: '/en/checkout', headers: { cookie } });
    const cross = await h.app.inject({
      method: 'POST',
      url: '/en/checkout',
      headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      payload: `csrf=${csrfFrom(page.body)}&workspace=${m.workspaceId}&plan=starter&currency=USDT`,
    });
    assert.equal(cross.statusCode, 403);
  });

  it('another user cannot create invoices for a workspace they do not own', async () => {
    const other = await webLogin(7002);
    const c2 = String(other.headers['set-cookie']).split(';')[0]!;
    const page = await h.app.inject({ method: 'GET', url: '/en/checkout', headers: { cookie: c2 } });
    assert.match(page.body, /free trial in the Millerenos bot/); // no workspace → no form
    const html = await h.app.inject({ method: 'GET', url: '/en/checkout', headers: { cookie } });
    const res = await h.app.inject({
      method: 'POST',
      url: '/en/checkout',
      headers: { cookie: c2, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `csrf=${csrfFrom(html.body)}&workspace=${m.workspaceId}&plan=starter&currency=USDT`,
    });
    assert.equal(res.statusCode, 403, 'csrf is bound to the session');
  });

  it('each open invoice gets a unique exact amount; pay page shows amount, address and network', async () => {
    const a = await createInvoice('USDT');
    const b = await createInvoice('USDT');
    assert.notEqual(a.amount, b.amount);
    for (const inv of [a, b]) {
      const extra = BigInt(inv.amount) - 5_000_000n;
      assert.ok(extra > 0n && extra < 100_000n && extra % 100n === 0n, inv.amount);
    }
    const page = await h.app.inject({ method: 'GET', url: `/en/pay/${a.id}`, headers: { cookie } });
    assert.match(page.body, new RegExp(`5\\.0\\d*\\s+USDT`));
    assert.ok(page.body.includes(ADDRESS));
    assert.match(page.body, /TRC-20/);
    assert.match(page.body, /http-equiv="refresh"/);
    const other = await webLogin(7003);
    const foreign = await h.app.inject({
      method: 'GET',
      url: `/en/pay/${a.id}`,
      headers: { cookie: String(other.headers['set-cookie']).split(';')[0]! },
    });
    assert.equal(foreign.statusCode, 404);
  });

  it('a confirmed transfer with the exact amount activates the plan exactly once', async () => {
    const inv = await createInvoice('USDT');
    tron.usdt = [{ txId: txid(1), amount: BigInt(inv.amount), timestamp: Date.now() }];
    const r1 = await processTronPayments(h.db, h.cfg, tron);
    assert.equal(r1.outcomes.filter((o) => o.kind === 'activated').length, 1);
    const r2 = await processTronPayments(h.db, h.cfg, tron);
    assert.equal(r2.outcomes.length, 0, 'same tx is never applied twice');
    const ws = await h.app.inject({ method: 'GET', url: `/api/v1/workspaces/${m.workspaceId}`, headers: m.auth });
    assert.equal(ws.json().access.state, 'subscribed');
    const page = await h.app.inject({ method: 'GET', url: `/en/pay/${inv.id}`, headers: { cookie } });
    assert.match(page.body, /Payment confirmed/);
    const pay = await h.db.system.query(`SELECT provider, currency FROM payments WHERE provider_charge_id = $1`, [txid(1)]);
    assert.deepEqual(pay.rows[0], { provider: 'tron_usdt', currency: 'USDT' });
  });

  it('TRX works the same way; unknown amounts and late payments are flagged, not applied', async () => {
    const inv = await createInvoice('TRX');
    assert.ok(BigInt(inv.amount) > 17_000_000n);
    tron.usdt = [];
    tron.trx = [
      { txId: txid(2), amount: BigInt(inv.amount), timestamp: Date.now() },
      { txId: txid(3), amount: 123_456n, timestamp: Date.now() },
    ];
    const r = await processTronPayments(h.db, h.cfg, tron);
    assert.deepEqual(r.outcomes.map((o) => o.kind).sort(), ['activated', 'needs_review']);

    const late = await createInvoice('USDT');
    tron.trx = [];
    tron.usdt = [{ txId: txid(4), amount: BigInt(late.amount), timestamp: new Date(late.expires_at).getTime() + 60_000 }];
    const r2 = await processTronPayments(h.db, h.cfg, tron);
    assert.equal(r2.outcomes[0]!.kind, 'needs_review');
    const audits = await h.db.system.query(`SELECT action FROM audit_logs WHERE action IN ('payment.orphan', 'payment.needs_review')`);
    assert.equal(audits.rows.length, 2);
  });

  it('TronGrid client ignores fake tokens, failed transfers and other recipients', async () => {
    const hex = tronAddressToHex(ADDRESS);
    const responses: Record<string, unknown> = {
      trc20: {
        data: [
          {
            transaction_id: txid(10),
            to: ADDRESS,
            type: 'Transfer',
            value: '5000100',
            block_timestamp: 1,
            token_info: { address: USDT_TRC20_CONTRACT },
          },
          {
            transaction_id: txid(11),
            to: ADDRESS,
            type: 'Transfer',
            value: '5000100',
            block_timestamp: 1,
            token_info: { address: 'TFakeUSDTcontract000000000000000000' },
          },
          {
            transaction_id: txid(12),
            to: tronAddress(2),
            type: 'Transfer',
            value: '5000100',
            block_timestamp: 1,
            token_info: { address: USDT_TRC20_CONTRACT },
          },
        ],
      },
      trx: {
        data: [
          {
            txID: txid(13),
            block_timestamp: 2,
            ret: [{ contractRet: 'SUCCESS' }],
            raw_data: { contract: [{ type: 'TransferContract', parameter: { value: { amount: 17000100, to_address: hex } } }] },
          },
          {
            txID: txid(14),
            block_timestamp: 2,
            ret: [{ contractRet: 'REVERT' }],
            raw_data: { contract: [{ type: 'TransferContract', parameter: { value: { amount: 17000100, to_address: hex } } }] },
          },
          {
            txID: txid(15),
            block_timestamp: 2,
            ret: [{ contractRet: 'SUCCESS' }],
            raw_data: { contract: [{ type: 'TransferAssetContract', parameter: { value: { amount: 17000100, to_address: hex } } }] },
          },
        ],
      },
    };
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(url.includes('/trc20') ? responses.trc20 : responses.trx), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new TronGridClient('https://api.trongrid.io', undefined, fakeFetch);
    assert.deepEqual(
      (await client.incomingUsdt(ADDRESS, 0)).map((t) => t.txId),
      [txid(10)],
    );
    assert.deepEqual(
      (await client.incomingTrx(ADDRESS, 0)).map((t) => t.txId),
      [txid(13)],
    );
    assert.ok(urls.every((u) => u.startsWith('https://api.trongrid.io/v1/accounts/') && u.includes('only_confirmed=true')));
  });

  it('superadmin can change plan prices (audited); others cannot', async () => {
    const { login } = await import('./helpers.js');
    const admin = await login(h, 999);
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/admin/plans/starter',
      headers: admin.auth,
      payload: { price_usdt_micro: 6_000_000 },
    });
    assert.equal(res.statusCode, 200, res.body);
    const denied = await h.app.inject({
      method: 'PATCH',
      url: '/api/admin/plans/starter',
      headers: m.auth,
      payload: { price_usdt_micro: 1 },
    });
    assert.equal(denied.statusCode, 404);
    const page = await h.app.inject({ method: 'GET', url: '/en/pricing' });
    assert.match(page.body, /or 6 USDT/);
  });
});
