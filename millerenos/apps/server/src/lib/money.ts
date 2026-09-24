// Amounts are stored as integer minor units. Currencies without minor units use exponent 0.
const ZERO_DECIMAL = new Set(['IRR', 'IRT', 'JPY', 'KRW', 'XTR', 'VND']);

export const currencyExponent = (currency: string) => (ZERO_DECIMAL.has(currency) ? 0 : 2);

export function formatMoney(minor: bigint | number | string, currency: string, locale = 'en'): string {
  const exp = currencyExponent(currency);
  const value = Number(minor) / 10 ** exp;
  if (currency === 'XTR') return `${value} ⭐`;
  try {
    return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      style: 'currency',
      currency: currency === 'IRT' ? 'IRR' : currency,
      maximumFractionDigits: exp,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}
