import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { existsSync } from 'node:fs';
import { DEFAULT_MINIAPP_DIR, buildApp } from '../src/http/app.js';
import { makeHarness } from './helpers.js';

describe('public website SEO & security headers', () => {
  let h: Awaited<ReturnType<typeof makeHarness>>;
  before(async () => {
    h = await makeHarness('web');
  });
  after(() => h.close());
  const get = (url: string) => h.app.inject({ method: 'GET', url });

  it('home pages are server-rendered with canonical, hreflang and correct direction', async () => {
    const en = await get('/en/');
    assert.equal(en.statusCode, 200);
    assert.match(en.body, /<html lang="en" dir="ltr">/);
    assert.match(en.body, /<link rel="canonical" href="https:\/\/millerenos.test\/en\/">/);
    assert.match(en.body, /hreflang="fa" href="https:\/\/millerenos.test\/fa\/"/);
    assert.match(en.body, /hreflang="x-default" href="https:\/\/millerenos.test\/"/);
    assert.match(en.body, /<h1>Run your business inside Telegram<\/h1>/);
    assert.match(en.body, /t\.me\/millerenos_test_bot\?start=src_web_home/);
    assert.match(en.body, /"@type":"Organization"/);
    const fa = await get('/fa/');
    assert.match(fa.body, /<html lang="fa" dir="rtl">/);
  });

  it('x-default root offers explicit language choice without redirecting', async () => {
    const res = await get('/');
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /href="\/fa\/"/);
    assert.match(res.body, /<link rel="canonical" href="https:\/\/millerenos.test\/">/);
  });

  it('every sitemap URL returns 200 and is self-canonical', async () => {
    const index = await get('/sitemap.xml');
    assert.match(index.body, /sitemap-en.xml/);
    for (const l of ['en', 'fa']) {
      const sm = await get(`/sitemap-${l}.xml`);
      const locs = [...sm.body.matchAll(/<loc>https:\/\/millerenos.test([^<]+)<\/loc>/g)].map((m) => m[1]!);
      assert.ok(locs.length >= 10);
      for (const path of locs) {
        const page = await get(path);
        assert.equal(page.statusCode, 200, path);
        assert.ok(page.body.includes(`<link rel="canonical" href="https://millerenos.test${path}">`), `canonical ${path}`);
        assert.equal((page.body.match(/<h1>/g) ?? []).length, 1, `single h1 on ${path}`);
        assert.match(page.body, /<meta name="description" content="[^"]{50,}"/);
      }
    }
  });

  it('robots.txt points to the sitemap and blocks private surfaces', async () => {
    const r = await get('/robots.txt');
    assert.match(r.body, /Sitemap: https:\/\/millerenos.test\/sitemap.xml/);
    assert.match(r.body, /Disallow: \/api\//);
    assert.match(r.body, /Disallow: \/app\//);
  });

  it('unknown pages return a real 404 (noindex); moved pages 301', async () => {
    const nf = await get('/en/does-not-exist');
    assert.equal(nf.statusCode, 404);
    assert.match(nf.body, /noindex/);
    const moved = await get('/en/home');
    assert.equal(moved.statusCode, 301);
    assert.equal(moved.headers.location, '/en/');
    const api404 = await get('/api/v1/nope');
    assert.equal(api404.statusCode, 404);
    assert.equal(api404.json().error.code, 'not_found');
  });

  it('integrations page never claims unavailable connectors are supported', async () => {
    const res = await get('/en/integrations');
    const row = (p: string) => res.body.match(new RegExp(`<tr><td>${p}</td><td><span class="badge (\\w+)">`))?.[1];
    assert.equal(row('telegram'), 'ok');
    for (const p of ['whatsapp', 'bale', 'rubika', 'eitaa']) assert.equal(row(p), 'no', p);
  });

  it('sets security headers: strict CSP with no scripts, nosniff, referrer policy', async () => {
    const res = await get('/en/security');
    assert.match(String(res.headers['content-security-policy']), /script-src 'none'/);
    assert.match(String(res.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.ok(res.headers['x-request-id']);
    const api = await get('/api/v1/plans');
    assert.equal(api.headers['cache-control'], 'no-store');
  });

  it('health, readiness and protected metrics', async () => {
    assert.equal((await get('/healthz')).statusCode, 200);
    assert.equal((await get('/readyz')).json().db, 'up');
    assert.equal((await get('/metrics')).statusCode, 404);
    const m = await h.app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer metrics_token_0123456789' } });
    assert.equal(m.statusCode, 200);
    assert.match(m.body, /http_request_duration_seconds/);
  });

  it('security.txt is published', async () => {
    const res = await get('/.well-known/security.txt');
    assert.match(res.body, /^Contact: /m);
    assert.match(res.body, /^Expires: /m);
  });

  it(
    'serves the Mini App with Telegram-only framing, noindex and cache rules; blocks traversal',
    { skip: !existsSync(DEFAULT_MINIAPP_DIR) && 'mini app not built' },
    async () => {
      const app = await buildApp(h.services, { miniappDir: DEFAULT_MINIAPP_DIR });
      const index = await app.inject({ method: 'GET', url: '/app/' });
      assert.equal(index.statusCode, 200);
      assert.match(String(index.headers['content-security-policy']), /frame-ancestors https:\/\/web\.telegram\.org/);
      assert.equal(index.headers['x-robots-tag'], 'noindex, nofollow');
      assert.equal(index.headers['cache-control'], 'no-cache');
      const asset = '/app/' + index.body.match(/\.\/(assets\/[^"]+\.js)/)![1];
      assert.match(String((await app.inject({ method: 'GET', url: asset })).headers['cache-control']), /immutable/);
      for (const url of ['/app/../package.json', '/app/%2e%2e/%2e%2e/package.json', '/app/..%2f..%2fpackage.json']) {
        const r = await app.inject({ method: 'GET', url });
        assert.ok(!r.body.includes('"@millerenos/server"'), url);
      }
      await app.close();
    },
  );

  it('serves everything under a base path such as /God', async () => {
    const { createServices } = await import('../src/services.js');
    const { createLogger } = await import('../src/logger.js');
    const { BOT_INFO, testConfig } = await import('./helpers.js');
    const cfg = testConfig(
      { appUrl: h.cfg.DATABASE_URL, systemUrl: h.cfg.DATABASE_SYSTEM_URL },
      { PUBLIC_BASE_URL: 'https://etebarami.test/God' },
    );
    const s2 = await createServices(cfg, createLogger('fatal'), { botInfo: BOT_INFO });
    const app = await buildApp(s2, { miniappDir: existsSync(DEFAULT_MINIAPP_DIR) ? DEFAULT_MINIAPP_DIR : '/nonexistent' });
    const en = await app.inject({ method: 'GET', url: '/God/en/' });
    assert.equal(en.statusCode, 200);
    assert.match(en.body, /<link rel="canonical" href="https:\/\/etebarami.test\/God\/en\/">/);
    assert.match(en.body, /href="\/God\/en\/pricing"/);
    assert.match(en.body, /href="\/God\/assets\/site\.[a-f0-9]+\.css"/);
    assert.ok(!/href="\/(en|fa)\//.test(en.body), 'no links escape the base path');
    const css = en.body.match(/href="(\/God\/assets\/site\.[a-f0-9]+\.css)"/)![1];
    assert.equal((await app.inject({ method: 'GET', url: css })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/God/healthz' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/God/api/v1/plans' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/en/' })).statusCode, 404);
    const nf = await app.inject({ method: 'GET', url: '/God/en/missing' });
    assert.equal(nf.statusCode, 404);
    assert.match((await app.inject({ method: 'GET', url: '/God/robots.txt' })).body, /Disallow: \/God\/api\//);
    assert.equal((await app.inject({ method: 'GET', url: '/God/en/home' })).headers.location, '/God/en/');
    if (existsSync(DEFAULT_MINIAPP_DIR)) {
      assert.equal((await app.inject({ method: 'GET', url: '/God/app' })).headers.location, '/God/app/');
      assert.equal((await app.inject({ method: 'GET', url: '/God/app/' })).statusCode, 200);
    }
    await app.close();
    await s2.db.close();
  });
});
