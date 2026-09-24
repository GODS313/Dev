import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import { LOCALES, RTL, isLocale, type Locale } from '../i18n/index.js';
import { listPlans } from '../modules/billing/billing.js';
import { CHANNELS } from '../modules/channels/registry.js';
import { COPY, PAGES, type PageId } from './content.js';
import { SITE_CSS } from './styles.js';

const CSS_HASH = createHash('sha256').update(SITE_CSS).digest('hex').slice(0, 10);
const CSS_PATH = `/assets/site.${CSS_HASH}.css`;

/** Permanent redirects for moved URLs (keep forever). */
export const REDIRECTS: Record<string, string> = {
  '/en/home': '/en/',
  '/fa/home': '/fa/',
};
/** Paths intentionally removed → 410 Gone. */
export const GONE = new Set<string>([]);

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const LOGO = `<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="9" fill="currentColor" opacity=".12"/><path d="M8 23V9l8 8 8-8v14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function webRoutes(app: FastifyInstance, deps: { cfg: Config; db: Db }) {
  const { cfg, db } = deps;
  const base = cfg.PUBLIC_BASE_URL.replace(/\/$/, '');
  const url = (locale: Locale, path: string) => `${base}/${locale}/${path}`;
  const ctaHref = (page: string) =>
    cfg.TELEGRAM_BOT_USERNAME ? `https://t.me/${cfg.TELEGRAM_BOT_USERNAME}?start=src_web_${page.replace(/-/g, '_')}` : null;

  function layout(
    locale: Locale,
    pageId: PageId | null,
    path: string,
    head: { title: string; description: string; noindex?: boolean; jsonLd?: unknown[] },
    body: string,
  ) {
    const c = COPY[locale];
    const other: Locale = locale === 'en' ? 'fa' : 'en';
    const canonical = pageId ? url(locale, path) : null;
    const alternates = pageId
      ? LOCALES.map((l) => `<link rel="alternate" hreflang="${l}" href="${url(l, path)}">`).join('') +
        `<link rel="alternate" hreflang="x-default" href="${pageId === 'home' ? `${base}/` : url('en', path)}">`
      : '';
    const navItems = (['features', 'pricing', 'integrations', 'security', 'about', 'contact'] as const)
      .map((id) => `<a href="/${locale}/${id}"${pageId === id ? ' aria-current="page"' : ''}>${esc(c.nav[id])}</a>`)
      .join('');
    const jsonLd = (head.jsonLd ?? [])
      .map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`)
      .join('');
    return `<!doctype html>
<html lang="${locale}" dir="${RTL[locale] ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(head.title)}</title>
<meta name="description" content="${esc(head.description)}">
${head.noindex ? '<meta name="robots" content="noindex">' : ''}
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}${alternates}
<meta property="og:type" content="website"><meta property="og:site_name" content="Millerenos">
<meta property="og:title" content="${esc(head.title)}"><meta property="og:description" content="${esc(head.description)}">
${canonical ? `<meta property="og:url" content="${canonical}">` : ''}<meta property="og:locale" content="${locale === 'fa' ? 'fa_IR' : 'en_US'}">
<meta property="og:image" content="${base}/assets/og.svg"><meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0f766e">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${CSS_PATH}">
${jsonLd}
</head>
<body>
<a class="skip" href="#content">${esc(c.skip)}</a>
<header class="site"><div class="wrap">
<a class="brand" href="/${locale}/" aria-label="Millerenos">${LOGO}<span>Millerenos</span></a>
<nav class="main" aria-label="Main">${navItems}</nav>
<a class="lang" href="/${other}/${path}" hreflang="${other}" lang="${other}">${esc(c.langSwitch)}</a>
</div></header>
<main id="content" class="wrap">${body}</main>
<footer class="site"><div class="wrap">
<div><strong>Millerenos</strong><br><span class="muted">© ${new Date().getUTCFullYear()} Millerenos. ${esc(c.footer.rights)}</span></div>
<nav aria-label="${esc(c.footer.legal)}"><a href="/${locale}/privacy">${esc(c.footer.privacy)}</a><a href="/${locale}/terms">${esc(c.footer.terms)}</a>
<a href="/${locale}/acceptable-use">${esc(c.footer.aup)}</a><a href="/${locale}/status">${esc(c.footer.status)}</a></nav>
</div></footer>
</body></html>`;
  }

  function cta(locale: Locale, page: string) {
    const href = ctaHref(page);
    if (!href) return '';
    const c = COPY[locale];
    return `<p><a class="btn" href="${esc(href)}" rel="noopener">${esc(c.cta)}</a><span class="note">${esc(c.ctaNote)}</span></p>`;
  }

  function sections(locale: Locale, id: PageId) {
    return COPY[locale].pages[id].sections
      .map(
        (s) =>
          `<section><h2>${esc(s.h)}</h2>${(s.p ?? []).map((p) => `<p>${esc(p)}</p>`).join('')}${
            s.list ? `<ul>${s.list.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>` : ''
          }</section>`,
      )
      .join('');
  }

  function breadcrumbs(locale: Locale, id: PageId, path: string) {
    if (id === 'home') return { html: '', ld: null };
    const c = COPY[locale];
    return {
      html: `<nav class="crumbs" aria-label="Breadcrumb"><a href="/${locale}/">${esc(c.breadcrumbHome)}</a> › <span aria-current="page">${esc(c.pages[id].h1)}</span></nav>`,
      ld: {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: c.breadcrumbHome, item: url(locale, '') },
          { '@type': 'ListItem', position: 2, name: c.pages[id].h1, item: url(locale, path) },
        ],
      },
    };
  }

  async function renderPage(locale: Locale, id: PageId, path: string): Promise<string> {
    const c = COPY[locale];
    const page = c.pages[id];
    const crumbs = breadcrumbs(locale, id, path);
    const jsonLd: unknown[] = crumbs.ld ? [crumbs.ld] : [];
    let extra = '';

    if (id === 'home') {
      jsonLd.push(
        { '@context': 'https://schema.org', '@type': 'Organization', name: 'Millerenos', url: base, logo: `${base}/favicon.svg` },
        { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Millerenos', url: base, inLanguage: locale },
      );
    }
    if (id === 'pricing') {
      const plans = await listPlans(db.app);
      extra =
        `<div class="cards"><div class="card"><h3>${esc(c.trialCard.title)}</h3><p class="muted">${esc(c.trialCard.text)}</p></div>` +
        plans
          .map(
            (p) =>
              `<div class="card"><h3>${esc(p.code[0]!.toUpperCase() + p.code.slice(1))}</h3><div class="price">${p.price_stars} ⭐</div>` +
              `<p class="muted">${esc(c.pricingPer(p.period_days))}</p><p>${esc(c.pricingLimits(p.limits.products ?? 0, p.limits.ai_requests_per_day ?? 0))}</p></div>`,
          )
          .join('') +
        `</div>`;
    }
    if (id === 'integrations') {
      const label = (s: string) =>
        s === 'OFFICIAL_SUPPORTED'
          ? locale === 'fa'
            ? 'پشتیبانی رسمی'
            : 'Supported'
          : locale === 'fa'
            ? 'هنوز در دسترس نیست'
            : 'Not available yet';
      extra =
        `<table><thead><tr><th>${locale === 'fa' ? 'پلتفرم' : 'Platform'}</th><th>${locale === 'fa' ? 'وضعیت' : 'Status'}</th><th>${locale === 'fa' ? 'روش' : 'Method'}</th></tr></thead><tbody>` +
        CHANNELS.map(
          (ch) =>
            `<tr><td>${esc(ch.platform.replace('_', ' '))}</td><td><span class="badge ${ch.status === 'OFFICIAL_SUPPORTED' ? 'ok' : 'no'}">${esc(label(ch.status))}</span></td><td>${esc(ch.method)}</td></tr>`,
        ).join('') +
        `</tbody></table>`;
    }
    if (id === 'status') {
      let ok = true;
      try {
        await db.app.query('SELECT 1');
      } catch {
        ok = false;
      }
      extra = `<p><span class="badge ${ok ? 'ok' : 'no'}">${ok ? (locale === 'fa' ? 'همه سرویس‌ها فعال' : 'All systems operational') : locale === 'fa' ? 'اختلال' : 'Degraded'}</span></p>`;
    }
    const showCta = ['home', 'features', 'pricing', 'contact'].includes(id);
    const body =
      `${crumbs.html}<section class="hero"><h1>${esc(page.h1)}</h1><p class="lead">${esc(page.lead)}</p>${showCta ? cta(locale, id) : ''}</section>` +
      extra +
      sections(locale, id) +
      (showCta && id !== 'contact' ? cta(locale, id) : '');
    return layout(locale, id, path, { title: page.title, description: page.description, noindex: id === 'status', jsonLd }, body);
  }

  const html = (reply: FastifyReply, body: string, status = 200, cache = 'public, max-age=300') =>
    reply.code(status).header('content-type', 'text/html; charset=utf-8').header('cache-control', cache).send(body);

  // x-default landing: explicit language choice, no automatic IP/crawler redirects.
  app.get('/', async (_req, reply) => {
    const body = `<section class="hero"><h1>Millerenos</h1>
      <p class="lead">${esc(COPY.en.pages.home.lead)}</p><p class="lead" lang="fa" dir="rtl">${esc(COPY.fa.pages.home.lead)}</p>
      <p><a class="btn" href="/en/" hreflang="en">English</a> <a class="btn" href="/fa/" hreflang="fa" lang="fa">فارسی</a></p></section>`;
    const page = layout(
      'en',
      null,
      '',
      { title: 'Millerenos — AI-powered commerce inside Telegram', description: COPY.en.pages.home.description },
      body,
    ).replace(
      '</head>',
      `<link rel="canonical" href="${base}/">${LOCALES.map((l) => `<link rel="alternate" hreflang="${l}" href="${url(l, '')}">`).join('')}<link rel="alternate" hreflang="x-default" href="${base}/"></head>`,
    );
    return html(reply, page);
  });

  for (const locale of LOCALES) {
    for (const p of PAGES) {
      app.get(`/${locale}/${p.path}`, async (_req, reply) =>
        html(reply, await renderPage(locale, p.id, p.path), 200, p.id === 'status' ? 'no-store' : 'public, max-age=300'),
      );
    }
    app.get(`/${locale}`, async (_req, reply) => reply.redirect(`/${locale}/`, 301));
  }

  app.get(CSS_PATH, async (_req, reply) =>
    reply.header('content-type', 'text/css; charset=utf-8').header('cache-control', 'public, max-age=31536000, immutable').send(SITE_CSS),
  );
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#0f766e"/><path d="M8 23V9l8 8 8-8v14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  app.get('/favicon.svg', async (_req, reply) =>
    reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=604800').send(favicon),
  );
  app.get('/assets/og.svg', async (_req, reply) =>
    reply
      .header('content-type', 'image/svg+xml')
      .header('cache-control', 'public, max-age=604800')
      .send(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0b1320"/><rect x="100" y="215" width="200" height="200" rx="52" fill="#0f766e"/><path d="M150 365V265l50 50 50-50v100" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><text x="350" y="345" fill="#e6edf6" font-family="system-ui,sans-serif" font-size="96" font-weight="700">Millerenos</text></svg>`,
      ),
  );

  app.get('/robots.txt', async (_req, reply) =>
    reply
      .header('content-type', 'text/plain; charset=utf-8')
      .send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app/\nDisallow: /tg/\n\nSitemap: ${base}/sitemap.xml\n`),
  );

  app.get('/sitemap.xml', async (_req, reply) =>
    reply
      .header('content-type', 'application/xml; charset=utf-8')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
          LOCALES.map((l) => `<sitemap><loc>${base}/sitemap-${l}.xml</loc></sitemap>`).join('') +
          `</sitemapindex>`,
      ),
  );
  for (const locale of LOCALES) {
    app.get(`/sitemap-${locale}.xml`, async (_req, reply) =>
      reply.header('content-type', 'application/xml; charset=utf-8').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">` +
          PAGES.filter((p) => p.inSitemap)
            .map(
              (p) =>
                `<url><loc>${url(locale, p.path)}</loc>${LOCALES.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${url(l, p.path)}"/>`).join('')}` +
                `<xhtml:link rel="alternate" hreflang="x-default" href="${p.id === 'home' ? `${base}/` : url('en', p.path)}"/><priority>${p.priority}</priority></url>`,
            )
            .join('') +
          `</urlset>`,
      ),
    );
  }

  app.get('/.well-known/security.txt', async (_req, reply) => {
    const expires = new Date(Date.now() + 180 * 86400_000).toISOString();
    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      .send(
        `Contact: ${process.env.SECURITY_CONTACT ?? (cfg.TELEGRAM_BOT_USERNAME ? `https://t.me/${cfg.TELEGRAM_BOT_USERNAME}` : `${base}/en/contact`)}\n` +
          `Expires: ${expires}\nPreferred-Languages: en, fa\nPolicy: ${base}/en/security\nCanonical: ${base}/.well-known/security.txt\n`,
      );
  });

  /** 404 / 410 / redirect handling for non-API paths. */
  return function notFoundPage(path: string, reply: FastifyReply) {
    const target = REDIRECTS[path];
    if (target) return reply.redirect(target, 301);
    const seg = path.split('/')[1];
    const locale: Locale = isLocale(seg) ? seg : 'en';
    const c = COPY[locale];
    const body = `<section class="hero"><h1>${esc(c.notFoundTitle)}</h1><p class="lead">${esc(c.notFoundText)}</p><p><a class="btn" href="/${locale}/">${esc(c.breadcrumbHome)}</a></p></section>`;
    return html(
      reply,
      layout(locale, null, '', { title: `${c.notFoundTitle} — Millerenos`, description: c.notFoundText, noindex: true }, body),
      GONE.has(path) ? 410 : 404,
      'no-store',
    );
  };
}
