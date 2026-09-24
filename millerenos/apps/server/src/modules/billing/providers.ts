/**
 * Payment provider registry. The choice of provider depends on product type, channel and
 * jurisdiction — see docs/INTEGRATIONS.md#payments.
 *
 *  - telegram_stars : REQUIRED for digital goods/services sold inside Telegram (Millerenos plans).
 *  - manual_transfer: merchant-confirmed offline payment for their own physical goods/services.
 *                     Millerenos never sees card data; the merchant marks the order paid.
 *
 * Card gateways (Stripe, local PSPs) plug in here later behind the same interface and a feature flag.
 */
export type PaymentProviderId = 'telegram_stars' | 'manual_transfer';

export interface PaymentProviderInfo {
  id: PaymentProviderId;
  status: 'OFFICIAL_SUPPORTED' | 'LIMITED_SUPPORTED' | 'EXPERIMENTAL' | 'UNAVAILABLE';
  usedFor: string;
  storesCardData: false;
}

export const PAYMENT_PROVIDERS: PaymentProviderInfo[] = [
  {
    id: 'telegram_stars',
    status: 'OFFICIAL_SUPPORTED',
    usedFor: 'Millerenos subscriptions (digital service inside Telegram)',
    storesCardData: false,
  },
  {
    id: 'manual_transfer',
    status: 'LIMITED_SUPPORTED',
    usedFor: 'Merchant orders confirmed manually by the merchant',
    storesCardData: false,
  },
];

export function selectProvider(ctx: { purpose: 'subscription' | 'order'; channel: 'telegram' | 'web' }): PaymentProviderId {
  if (ctx.purpose === 'subscription' && ctx.channel === 'telegram') return 'telegram_stars';
  if (ctx.purpose === 'order') return 'manual_transfer';
  throw new Error('No compliant payment provider for this context yet');
}
