// Minimal typing for the Telegram WebApp object we use (https://core.telegram.org/bots/webapps).
interface TgWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { language_code?: string } };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  platform: string;
  ready(): void;
  expand(): void;
  openInvoice(url: string, cb?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  showAlert(msg: string): void;
  HapticFeedback?: { notificationOccurred(t: 'success' | 'error' | 'warning'): void };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  onEvent(e: string, cb: () => void): void;
  setHeaderColor?(c: string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TgWebApp };
  }
}

export const tg: TgWebApp | null = window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : null;

export function haptic(type: 'success' | 'error' | 'warning') {
  tg?.HapticFeedback?.notificationOccurred(type);
}

export function openTelegramShare(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg) tg.openTelegramLink(share);
  else window.open(share, '_blank', 'noopener');
}

/** Screen routing uses query params; Telegram keeps its launch data in the hash. */
export function launchParams() {
  const q = new URLSearchParams(location.search);
  const start = tg?.initDataUnsafe.start_param ?? '';
  const store = q.get('store') ?? (start.startsWith('store_') ? start.slice(6) : null);
  return { store: store && /^[a-z0-9-]{3,40}$/.test(store) ? store : null, page: q.get('p') };
}
