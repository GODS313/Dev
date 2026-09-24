const ZERO_DECIMAL = new Set(['IRR', 'IRT', 'JPY', 'KRW', 'XTR', 'VND']);
export const exponent = (currency: string) => (ZERO_DECIMAL.has(currency) ? 0 : 2);

export function formatMoney(minor: string | number, currency: string, locale: string) {
  const exp = exponent(currency);
  const v = Number(minor) / 10 ** exp;
  if (currency === 'XTR') return `${v} ⭐`;
  try {
    return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      style: 'currency',
      currency: currency === 'IRT' ? 'IRR' : currency,
      maximumFractionDigits: exp,
    }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
}

/** Parses a user-typed amount ("12.5", "۱۲٫۵", "1,200") into integer minor units, or null. */
export function parseAmount(input: string, currency: string): number | null {
  const normalized = input
    .trim()
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫]/g, '.')
    .replace(/[,٬\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const exp = exponent(currency);
  const [whole, frac = ''] = normalized.split('.');
  if (frac.length > exp) return null;
  const minor = Number(whole) * 10 ** exp + Number((frac + '00').slice(0, exp) || 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

export const toMajorString = (minor: string | number, currency: string) => {
  const exp = exponent(currency);
  return exp === 0 ? String(minor) : (Number(minor) / 10 ** exp).toFixed(exp);
};
