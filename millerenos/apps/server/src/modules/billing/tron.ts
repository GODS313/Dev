import { createHash, randomInt } from 'node:crypto';
import type { Config } from '../../config.js';
import type { Db, Queryable } from '../../db/pool.js';
import { AppError, notFound } from '../../lib/errors.js';
import { track } from '../analytics/track.js';
import { audit } from '../audit/audit.js';
import { isEnabled } from '../flags/flags.js';
import { applyInvoicePayment, type PaymentOutcome } from './billing.js';

/**
 * TRON network payments: USDT (TRC-20) and TRX, sent by the customer from their own wallet to the platform's
 * receive-only address. Detection uses the public TronGrid API (confirmed transactions only). No private keys,
 * no custody, no card data. Each open invoice has a unique exact amount so a transfer maps to one invoice.
 */
export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export type CryptoCurrency = 'USDT' | 'TRX';
const PROVIDER: Record<CryptoCurrency, 'tron_usdt' | 'tron_trx'> = { USDT: 'tron_usdt', TRX: 'tron_trx' };
/** Unique-amount offset step: 0.0001 (both assets have 6 decimals) × 1..999 → at most +0.0999. */
const OFFSET_STEP = 100n;
const OFFSET_SLOTS = 999;

export interface IncomingTransfer {
  txId: string;
  amount: bigint; // 6-decimal base units
  timestamp: number; // ms
}

export interface TronClient {
  incomingUsdt(address: string, sinceMs: number): Promise<IncomingTransfer[]>;
  incomingTrx(address: string, sinceMs: number): Promise<IncomingTransfer[]>;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Base58Check TRON address → 21-byte hex ("41…"); throws on bad checksum. */
export function tronAddressToHex(address: string): string {
  let n = 0n;
  for (const c of address) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error('invalid base58');
    n = n * 58n + BigInt(i);
  }
  const bytes = Buffer.from(n.toString(16).padStart(50, '0'), 'hex');
  const payload = bytes.subarray(0, 21);
  const check = bytes.subarray(21);
  const hash = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest();
  if (!hash.subarray(0, 4).equals(check) || payload[0] !== 0x41) throw new Error('invalid TRON address');
  return payload.toString('hex');
}

export class TronGridClient implements TronClient {
  constructor(
    private base: string,
    private apiKey?: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async get(path: string, query: Record<string, string>) {
    // Fixed host from configuration + validated address: no user-controlled URLs (SSRF-safe).
    const url = `${this.base.replace(/\/$/, '')}${path}?${new URLSearchParams(query)}`;
    const res = await this.fetchImpl(url, {
      headers: { accept: 'application/json', ...(this.apiKey ? { 'TRON-PRO-API-KEY': this.apiKey } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`TronGrid HTTP ${res.status}`);
    return (await res.json()) as { data?: unknown[] };
  }

  async incomingUsdt(address: string, sinceMs: number): Promise<IncomingTransfer[]> {
    tronAddressToHex(address);
    const body = await this.get(`/v1/accounts/${address}/transactions/trc20`, {
      only_to: 'true',
      only_confirmed: 'true',
      contract_address: USDT_TRC20_CONTRACT,
      min_timestamp: String(sinceMs),
      limit: '200',
    });
    const out: IncomingTransfer[] = [];
    for (const raw of body.data ?? []) {
      const t = raw as {
        transaction_id?: string;
        to?: string;
        value?: string;
        type?: string;
        block_timestamp?: number;
        token_info?: { address?: string };
      };
      // Defense in depth: a fake token named "USDT" has a different contract address.
      if (t.token_info?.address !== USDT_TRC20_CONTRACT || t.to !== address || t.type !== 'Transfer') continue;
      if (!t.transaction_id || !/^[0-9a-f]{64}$/.test(t.transaction_id) || !t.value || !/^\d{1,30}$/.test(t.value)) continue;
      out.push({ txId: t.transaction_id, amount: BigInt(t.value), timestamp: Number(t.block_timestamp) });
    }
    return out;
  }

  async incomingTrx(address: string, sinceMs: number): Promise<IncomingTransfer[]> {
    const hex = tronAddressToHex(address);
    const body = await this.get(`/v1/accounts/${address}/transactions`, {
      only_to: 'true',
      only_confirmed: 'true',
      min_timestamp: String(sinceMs),
      limit: '200',
    });
    const out: IncomingTransfer[] = [];
    for (const raw of body.data ?? []) {
      const t = raw as {
        txID?: string;
        block_timestamp?: number;
        ret?: { contractRet?: string }[];
        raw_data?: { contract?: { type?: string; parameter?: { value?: { amount?: number; to_address?: string } } }[] };
      };
      const c = t.raw_data?.contract?.[0];
      if (c?.type !== 'TransferContract' || t.ret?.[0]?.contractRet !== 'SUCCESS') continue;
      if (c.parameter?.value?.to_address?.toLowerCase() !== hex || !Number.isSafeInteger(c.parameter.value.amount)) continue;
      if (!t.txID || !/^[0-9a-f]{64}$/.test(t.txID)) continue;
      out.push({ txId: t.txID, amount: BigInt(c.parameter.value.amount!), timestamp: Number(t.block_timestamp) });
    }
    return out;
  }
}

export function formatUnits6(v: bigint | string): string {
  const n = BigInt(v);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Creates a crypto invoice with a unique exact amount for the plan. Web checkout only. */
export async function createCryptoInvoice(
  db: Db,
  cfg: Config,
  input: { workspaceId: string; userId: string; planCode: string; currency: CryptoCurrency },
) {
  if (!cfg.TRON_RECEIVE_ADDRESS) throw new AppError('not_configured', 'Crypto payments are not configured yet');
  if (!(await isEnabled(db.app, 'payments.tron', input.workspaceId)))
    throw new AppError('feature_disabled', 'Crypto checkout is unavailable');
  const provider = PROVIDER[input.currency];
  return db.tenant(input.workspaceId, async (q) => {
    const plan = await q.query(
      'SELECT code, price_usdt_micro::text AS usdt, price_trx_sun::text AS trx FROM plans WHERE code = $1 AND is_active',
      [input.planCode],
    );
    const base = plan.rows[0]?.[input.currency === 'USDT' ? 'usdt' : 'trx'];
    if (!base) throw notFound('Plan');
    for (let attempt = 0; attempt < 12; attempt++) {
      const amount = BigInt(base) + BigInt(randomInt(1, OFFSET_SLOTS + 1)) * OFFSET_STEP;
      const res = await q.query(
        `INSERT INTO invoices (workspace_id, purpose, plan_code, payer_user_id, provider, currency, amount_minor, payload_nonce, pay_to, expires_at)
         SELECT $1, 'subscription', $2, $3, $4, $5, $6, 'tron_' || gen_random_uuid(), $7, now() + make_interval(mins => $8)
         WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE provider = $4 AND amount_minor = $6 AND status = 'open')
         ON CONFLICT DO NOTHING
         RETURNING id, amount_minor::text AS amount, expires_at`,
        [
          input.workspaceId,
          input.planCode,
          input.userId,
          provider,
          input.currency,
          amount.toString(),
          cfg.TRON_RECEIVE_ADDRESS,
          cfg.CRYPTO_INVOICE_TTL_MINUTES,
        ],
      );
      // tenant RLS hides other tenants' invoices from the NOT EXISTS check; the partial unique index is the real guard
      if (res.rows[0]) {
        await track(q, 'checkout_started', {
          userId: input.userId,
          workspaceId: input.workspaceId,
          props: { plan: input.planCode, provider },
        });
        return { id: res.rows[0].id as string, amount: res.rows[0].amount as string, expiresAt: res.rows[0].expires_at as Date };
      }
    }
    throw new AppError('rate_limited', 'Checkout is busy, please try again');
  });
}

/**
 * Polls confirmed incoming transfers and applies them to invoices. Idempotent per tx id.
 * On-time transfer with the exact amount → activates the plan. Otherwise → recorded / flagged for admin review.
 */
export async function processTronPayments(db: Db, cfg: Config, client: TronClient, now = Date.now()) {
  const address = cfg.TRON_RECEIVE_ADDRESS;
  if (!address) return { checked: 0, outcomes: [] as PaymentOutcome[] };
  const outcomes: PaymentOutcome[] = [];
  let checked = 0;
  for (const currency of ['USDT', 'TRX'] as const) {
    const provider = PROVIDER[currency];
    const oldest = await db.system.query(
      `SELECT min(created_at) AS since FROM invoices WHERE provider = $1 AND (status = 'open' OR created_at > now() - interval '1 day')`,
      [provider],
    );
    if (!oldest.rows[0].since) continue;
    const since = (oldest.rows[0].since as Date).getTime() - 10 * 60_000;
    const transfers = currency === 'USDT' ? await client.incomingUsdt(address, since) : await client.incomingTrx(address, since);
    for (const tx of transfers) {
      checked++;
      const outcome = await db.systemTx(async (q) => {
        const ev = await q.query(
          `INSERT INTO webhook_events (provider, event_id) VALUES ('tron', $1) ON CONFLICT DO NOTHING RETURNING id`,
          [tx.txId],
        );
        if (!ev.rows[0]) return null; // already handled
        const inv = await matchInvoice(q, provider, tx);
        if (!inv) {
          await audit(q, { action: 'payment.orphan', metadata: { provider, txId: tx.txId, amount: tx.amount.toString() } });
          return { kind: 'needs_review' as const, workspaceId: null, reason: 'unknown_invoice' };
        }
        const late = tx.timestamp > inv.expires_at.getTime();
        const result = await applyInvoicePayment(q, late ? { ...inv, status: 'late' } : inv, {
          provider,
          chargeId: tx.txId,
          currency,
          amount: tx.amount.toString(),
        });
        if (result.kind === 'activated') await q.query('UPDATE webhook_events SET processed_at = now() WHERE id = $1', [ev.rows[0].id]);
        return result;
      });
      if (outcome) outcomes.push(outcome);
    }
  }
  // Void expired invoices after a grace period that covers confirmation + polling delay.
  await db.system.query(
    `UPDATE invoices SET status = 'void' WHERE provider IN ('tron_usdt', 'tron_trx') AND status = 'open' AND expires_at < to_timestamp($1 / 1000.0) - interval '1 hour'`,
    [now],
  );
  return { checked, outcomes };
}

async function matchInvoice(q: Queryable, provider: string, tx: IncomingTransfer) {
  const res = await q.query(
    `SELECT id, workspace_id, plan_code, purpose, currency, amount_minor::text, status, expires_at FROM invoices
      WHERE provider = $1 AND amount_minor = $2 AND created_at <= to_timestamp($3 / 1000.0) + interval '5 minutes'
        AND created_at > to_timestamp($3 / 1000.0) - interval '2 days'
      ORDER BY (status = 'open') DESC, created_at DESC LIMIT 1 FOR UPDATE`,
    [provider, tx.amount.toString(), tx.timestamp],
  );
  return res.rows[0] as
    | {
        id: string;
        workspace_id: string;
        plan_code: string | null;
        purpose: string;
        currency: string;
        amount_minor: string;
        status: string;
        expires_at: Date;
      }
    | undefined;
}
