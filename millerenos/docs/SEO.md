# SEO architecture

- **Rendering**: server-side HTML from `apps/server/src/web` (no client JS required; `script-src 'none'`).
- **URLs**: `/{locale}/{page}` — `/en/`, `/fa/`, `/en/pricing` … Lowercase, hyphenated, no query strings for content.
  `/` is the x-default language chooser; `/en` → 301 `/en/`. Moved URLs → `REDIRECTS` (301); removed → `GONE` (410);
  unknown → real 404 with `noindex`.
- **Head**: unique `<title>` and meta description per page and locale, self-referencing canonical, `hreflang` for
  every locale + `x-default`, Open Graph/Twitter tags, theme color, SVG favicon.
- **Structured data**: `Organization` + `WebSite` (home), `BreadcrumbList` (inner pages). No `Product`/`Review`/
  `AggregateRating` markup — we do not publish reviews we do not have.
- **Sitemaps**: `/sitemap.xml` index → `/sitemap-en.xml`, `/sitemap-fa.xml` with `xhtml:link` alternates. Only
  indexable pages are listed (status page is `noindex` and excluded).
- **robots.txt**: allows the site; disallows `/api/`, `/app/`, `/tg/`; lists the sitemap. Mini App and admin also send
  `X-Robots-Tag: noindex, nofollow`.
- **Performance**: ~10 KB HTML, one immutable-cached CSS file (hashed name), no web fonts, no JS.
- **Crawlers & language**: no IP/Accept-Language redirects. Users switch language explicitly (link in the header).
- **CTAs**: "Start free in Telegram" → `t.me/<bot>?start=src_web_<page>` so acquisition by page is measurable
  (`bot_started.source`).
- **Quality gates (tests)**: every sitemap URL returns 200, is self-canonical, has exactly one `<h1>` and a
  description ≥ 50 chars.

## Content rules
Useful to humans first; only describe capabilities that exist (the integrations page is generated from the registry).
No keyword stuffing, doorway pages, cloaking, hidden text, fake reviews/backlinks, or mass-generated AI pages.
Programmatic pages (e.g. public store pages, integration pages) are allowed only with real, differentiated data and
start as `noindex` until they pass a quality threshold (content length, unique products, published store, activity).

## Next (BACKLOG)
Help center/docs section, blog with reviewed articles in both languages, public store pages (SSR, opt-in indexing),
Search Console + Bing Webmaster verification, Core Web Vitals RUM, per-locale OG images.

## Hosting under a path (etebarami.net/God)
Supported technically (canonical, hreflang and sitemaps include `/God`). Limits: `robots.txt` is only honored at the
host root (etebarami.net/robots.txt, outside this app), so submit `https://etebarami.net/God/sitemap.xml` directly in
Search Console; brand authority accrues to etebarami.net rather than a Millerenos domain. A dedicated domain is
recommended once the brand launches publicly; 301 redirects from `/God/...` will preserve rankings.
