// Content model for the single-box download page (/dl) and its CMS API.
// Every field here is public once saved -- none of it is a secret, unlike
// bot_settings (tokens) which stays in its own encrypted table.

export const ICONS = Object.freeze([
  'bolt', 'shield', 'users', 'map', 'clock', 'star', 'gift', 'check', 'heart', 'globe',
]);
const ICON_SET = new Set(ICONS);

export const DEFAULT_CONTENT = Object.freeze({
  app_name: 'همکاره',
  tagline: 'دستیار استخدام و همکاری شما',
  description: 'با اپلیکیشن همکاره فرصت‌های همکاری نزدیک خودتان را پیدا کنید، در چند دقیقه ثبت‌نام کنید و وضعیت درخواستتان را دنبال کنید.',
  cta_label: 'دانلود مستقیم اپلیکیشن',
  version_label: '',
  footer_note: 'نصب روی اندروید ۷ به بالا · بدون نیاز به گوگل‌پلی',
  telegram_url: '',
  bale_url: '',
  features: [
    { icon: 'bolt', title: 'ثبت‌نام دو دقیقه‌ای', desc: 'فرم کوتاه، بدون کاغذبازی.' },
    { icon: 'map', title: 'فرصت‌های نزدیک شما', desc: 'بر اساس استان و شهر خودتان.' },
    { icon: 'shield', title: 'اطلاعات شما امن است', desc: 'فقط برای بررسی همکاری استفاده می‌شود.' },
  ],
  theme: Object.freeze({
    bg_from: '#071d36',
    bg_to: '#0b3866',
    accent: '#ffc957',
    accent_2: '#6ce0bd',
  }),
  logo_media_id: '',
  icon_media_id: '',
  screenshot_media_ids: Object.freeze([]),
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const URL_RE = /^https:\/\/[^\s<>"']{3,300}$/;
const MEDIA_ID_RE = /^[a-f0-9-]{8,64}\.(png|jpe?g|webp)$/i;

function cleanText(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

export function sanitizeContent(input, previous) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('داده نامعتبر است');
  const base = previous || DEFAULT_CONTENT;

  const out = {
    app_name: cleanText(input.app_name ?? base.app_name, 60) || DEFAULT_CONTENT.app_name,
    tagline: cleanText(input.tagline ?? base.tagline, 120),
    description: cleanText(input.description ?? base.description, 600),
    cta_label: cleanText(input.cta_label ?? base.cta_label, 40) || DEFAULT_CONTENT.cta_label,
    version_label: cleanText(input.version_label ?? base.version_label, 60),
    footer_note: cleanText(input.footer_note ?? base.footer_note, 160),
    telegram_url: '',
    bale_url: '',
    features: [],
    theme: {},
    logo_media_id: '',
    icon_media_id: '',
    screenshot_media_ids: [],
  };

  for (const name of ['telegram_url', 'bale_url']) {
    const value = cleanText(input[name] ?? base[name], 300);
    if (value && !URL_RE.test(value)) throw new Error(`آدرس نامعتبر: ${name}`);
    out[name] = value;
  }

  const featuresIn = Array.isArray(input.features) ? input.features : base.features;
  for (const feature of featuresIn.slice(0, 8)) {
    if (!feature || typeof feature !== 'object') continue;
    const title = cleanText(feature.title, 40);
    if (!title) continue;
    out.features.push({
      icon: ICON_SET.has(feature.icon) ? feature.icon : 'star',
      title,
      desc: cleanText(feature.desc, 100),
    });
  }

  const themeIn = (input.theme && typeof input.theme === 'object') ? input.theme : base.theme;
  for (const key of Object.keys(DEFAULT_CONTENT.theme)) {
    const value = String(themeIn[key] || DEFAULT_CONTENT.theme[key]).trim();
    out.theme[key] = HEX.test(value) ? value : DEFAULT_CONTENT.theme[key];
  }

  for (const name of ['logo_media_id', 'icon_media_id']) {
    const value = cleanText(input[name] ?? base[name], 80);
    out[name] = (!value || MEDIA_ID_RE.test(value)) ? value : '';
  }

  const shotsIn = Array.isArray(input.screenshot_media_ids) ? input.screenshot_media_ids : base.screenshot_media_ids;
  out.screenshot_media_ids = shotsIn.filter((id) => typeof id === 'string' && MEDIA_ID_RE.test(id)).slice(0, 6);

  return out;
}

export function withMediaUrls(content) {
  return {
    ...content,
    logo_url: content.logo_media_id ? `/media/${content.logo_media_id}` : '',
    icon_url: content.icon_media_id ? `/media/${content.icon_media_id}` : '',
    screenshot_urls: content.screenshot_media_ids.map((id) => `/media/${id}`),
  };
}
