import { en } from './en.js';
import { fa } from './fa.js';

export type Locale = 'en' | 'fa';
export const LOCALES: Locale[] = ['en', 'fa'];
export const RTL: Record<Locale, boolean> = { en: false, fa: true };
export type MessageKey = keyof typeof en;

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, fa };

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'fa';
}

/** Translate with {placeholder} interpolation. Falls back to English, then to the key. */
export function t(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = catalogs[locale]?.[key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

export function formatDuration(locale: Locale, seconds: number): string {
  const m = Math.max(0, Math.ceil(seconds / 60));
  return locale === 'fa' ? `${m.toLocaleString('fa-IR')} دقیقه` : `${m} min`;
}
