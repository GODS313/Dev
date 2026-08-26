import { DEFAULT_CONTENT, sanitizeContent, withMediaUrls } from './_lib/content.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

const ICON_PATHS = {
  bolt: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5l-8-3Z"/>',
  users: '<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="9.5" cy="8" r="3.2"/><path d="M20 19v-1a4 4 0 0 0-3-3.9"/><path d="M15.3 4.2a4 4 0 0 1 0 7.6"/>',
  map: '<path d="M9 18 3.5 20V6L9 4l6 2 5.5-2v14L15 20l-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2Z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12h14v9H5z"/><path d="M12 8v13"/><path d="M12 8C9 8 8 6.5 8 5a2.5 2.5 0 0 1 5-.4"/><path d="M12 8c3 0 4-1.5 4-3a2.5 2.5 0 0 0-5-.4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  heart: '<path d="M12 20.5S3.5 15 3.5 8.8A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 8.5 2C20.5 15 12 20.5 12 20.5Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.7 5.6 3.7 9s-1.3 6.5-3.7 9c-2.4-2.5-3.7-5.6-3.7-9S9.6 5.5 12 3Z"/>',
};

function icon(name, cls) {
  return `<svg class="${cls || 'ic'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ICON_PATHS.star}</svg>`;
}

async function loadContent(env) {
  if (!env.DB) return DEFAULT_CONTENT;
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS site_content(
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
    const row = await env.DB.prepare('SELECT value FROM site_content WHERE key = ?').bind('download_page').first();
    if (!row) return DEFAULT_CONTENT;
    return sanitizeContent(JSON.parse(row.value), DEFAULT_CONTENT);
  } catch {
    return DEFAULT_CONTENT;
  }
}

function renderFeature(feature) {
  return `<li class="feat">
    <span class="feat-ic">${icon(feature.icon)}</span>
    <span class="feat-copy"><b>${esc(feature.title)}</b>${feature.desc ? `<small>${esc(feature.desc)}</small>` : ''}</span>
  </li>`;
}

function renderMessenger(url, label, kind) {
  if (!url) return '';
  return `<a class="msg msg-${kind}" href="${esc(url)}" target="_blank" rel="noopener">
    <span class="msg-ic">${kind === 'telegram' ? icon('bolt') : icon('check')}</span>${esc(label)}
  </a>`;
}

export async function onRequestGet({ env }) {
  const raw = await loadContent(env);
  const c = withMediaUrls(raw);
  const t = c.theme;

  const logoBlock = c.logo_url
    ? `<img class="logo-img" src="${esc(c.logo_url)}" alt="${esc(c.app_name)}">`
    : `<span class="logo-mono">${esc((c.app_name || 'ه').trim().charAt(0))}</span>`;

  const featuresHtml = c.features.length
    ? `<ul class="feats">${c.features.map(renderFeature).join('')}</ul>`
    : '';

  const shotsHtml = c.screenshot_urls.length
    ? `<div class="shots">${c.screenshot_urls.map((src) => `<img src="${esc(src)}" alt="پیش‌نمایش اپلیکیشن ${esc(c.app_name)}" loading="lazy">`).join('')}</div>`
    : '';

  const messengersHtml = [
    renderMessenger(c.telegram_url, 'دریافت از تلگرام', 'telegram'),
    renderMessenger(c.bale_url, 'دریافت از بله', 'bale'),
  ].join('');

  const iconBlock = c.icon_url ? `<link rel="icon" href="${esc(c.icon_url)}">` : '<link rel="icon" href="/favicon.svg" type="image/svg+xml">';

  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>دانلود ${esc(c.app_name)}</title>
<meta name="description" content="${esc(c.tagline || c.description)}">
<meta property="og:title" content="دانلود ${esc(c.app_name)}">
<meta property="og:description" content="${esc(c.tagline || c.description)}">
${c.icon_url ? `<meta property="og:image" content="${esc(c.icon_url)}">` : ''}
<meta name="theme-color" content="${esc(t.bg_from)}">
${iconBlock}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&display=swap">
<style>
:root{
  --bg-from:${t.bg_from};--bg-to:${t.bg_to};--accent:${t.accent};--accent-2:${t.accent_2};
  --ink:#101828;--muted:#5e6e83;--line:#e6e9f0;--card:#ffffff;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  min-height:100dvh;font-family:'Vazirmatn',Tahoma,'Segoe UI',Arial,sans-serif;
  background:radial-gradient(120% 90% at 85% -10%,color-mix(in srgb,var(--accent-2) 22%,transparent),transparent 60%),
             linear-gradient(150deg,var(--bg-from) 0%,var(--bg-to) 100%);
  color:var(--ink);display:flex;align-items:center;justify-content:center;padding:28px 16px;position:relative;overflow-x:hidden;
}
.orb{position:fixed;border-radius:50%;filter:blur(2px);opacity:.55;pointer-events:none;z-index:0}
.orb-a{width:340px;height:340px;top:-120px;right:-90px;background:radial-gradient(circle,color-mix(in srgb,var(--accent-2) 70%,transparent),transparent 70%)}
.orb-b{width:260px;height:260px;bottom:-110px;left:-80px;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 65%,transparent),transparent 70%)}
@media (prefers-reduced-motion:no-preference){
  .orb-a{animation:float-a 14s ease-in-out infinite}
  .orb-b{animation:float-b 16s ease-in-out infinite}
  .card{animation:rise .6s cubic-bezier(.2,.7,.2,1) both}
}
@keyframes float-a{0%,100%{transform:translate(0,0)}50%{transform:translate(-16px,18px)}}
@keyframes float-b{0%,100%{transform:translate(0,0)}50%{transform:translate(18px,-14px)}}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}

.card{
  position:relative;z-index:1;width:100%;max-width:462px;background:var(--card);
  border-radius:28px;padding:36px 30px 28px;box-shadow:0 40px 90px -30px rgba(4,12,26,.55);
  text-align:center;
}
.logo-img{width:76px;height:76px;border-radius:20px;object-fit:cover;margin:0 auto 18px;display:block;box-shadow:0 10px 24px rgba(0,0,0,.14)}
.logo-mono{
  width:76px;height:76px;margin:0 auto 18px;border-radius:20px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,var(--accent),var(--accent-2));color:var(--bg-from);font-weight:800;font-size:32px;
}
h1{margin:0 0 6px;font-size:23px;font-weight:800;letter-spacing:-.2px}
.tagline{margin:0 0 14px;color:var(--muted);font-size:14.5px;font-weight:500}
.desc{margin:0 0 22px;color:var(--muted);font-size:13.5px;line-height:1.85}

.feats{list-style:none;margin:0 0 24px;padding:0;display:grid;gap:10px;text-align:right}
.feat{display:flex;align-items:flex-start;gap:11px;background:#f6f7fb;border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.feat-ic{flex-shrink:0;width:32px;height:32px;border-radius:10px;background:color-mix(in srgb,var(--accent) 18%,#fff);color:color-mix(in srgb,var(--bg-from) 82%,var(--accent));display:flex;align-items:center;justify-content:center}
.feat-ic .ic{width:17px;height:17px}
.feat-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.feat-copy b{font-size:13px;font-weight:700}
.feat-copy small{font-size:12px;color:var(--muted);line-height:1.6}

.cta{
  display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:56px;border:0;border-radius:16px;
  background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 75%,#fff));color:var(--bg-from);
  font:inherit;font-size:16px;font-weight:800;text-decoration:none;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease;
  box-shadow:0 16px 30px -12px color-mix(in srgb,var(--accent) 70%,transparent);
}
.cta:hover{transform:translateY(-2px)}
.cta:focus-visible{outline:2.5px solid var(--bg-from);outline-offset:3px}
.version{margin:9px 0 0;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}

.msgs{display:flex;gap:10px;margin-top:16px}
.msg{
  flex:1;display:flex;align-items:center;justify-content:center;gap:7px;min-height:44px;border-radius:12px;
  border:1.5px solid var(--line);color:var(--ink);text-decoration:none;font-size:12.5px;font-weight:700;transition:border-color .15s,color .15s;
}
.msg:hover{border-color:var(--bg-from);color:var(--bg-from)}
.msg-ic .ic{width:15px;height:15px}

.shots{display:flex;gap:10px;overflow-x:auto;margin-top:22px;padding-bottom:4px;scroll-snap-type:x proximity}
.shots img{scroll-snap-align:start;height:220px;border-radius:16px;border:1px solid var(--line);flex-shrink:0;object-fit:cover}

.foot{margin-top:22px;padding-top:16px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted)}
.back{position:relative;z-index:1;margin-top:16px;text-align:center;display:block;font-size:12.5px;color:rgba(255,255,255,.65);text-decoration:none}
.back:hover{color:#fff}
.wrap{display:flex;flex-direction:column;align-items:center}
@media (max-width:420px){.card{padding:28px 20px 22px;border-radius:22px}h1{font-size:20px}}
</style>
</head>
<body>
<span class="orb orb-a"></span><span class="orb orb-b"></span>
<div class="wrap">
  <main class="card">
    ${logoBlock}
    <h1>${esc(c.app_name)}</h1>
    ${c.tagline ? `<p class="tagline">${esc(c.tagline)}</p>` : ''}
    ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ''}
    ${featuresHtml}
    <a class="cta" href="/download">${icon('bolt', 'ic')}${esc(c.cta_label)}</a>
    ${c.version_label ? `<p class="version">${esc(c.version_label)}</p>` : ''}
    ${messengersHtml ? `<div class="msgs">${messengersHtml}</div>` : ''}
    ${shotsHtml}
    ${c.footer_note ? `<p class="foot">${esc(c.footer_note)}</p>` : ''}
  </main>
  <a class="back" href="/">بازگشت به سایت همکاره ←</a>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
