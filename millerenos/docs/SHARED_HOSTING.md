# Shared-hosting edition (etebarami.net/God)

The founder's host (cPanel "SHARED Basic") has no Node.js/PostgreSQL/Docker and blocks automated cPanel API logins,
so Millerenos ships a second server edition for it, deployed by GitHub Actions over FTPS
(`.github/workflows/deploy-millerenos-host.yml`).

| Part | Node edition (VPS) | Shared-hosting edition |
|---|---|---|
| Server | `apps/server` (Fastify, TypeScript) | `lite/src` (PHP ≥ 8.1, no framework) |
| Database | PostgreSQL + row-level security | SQLite (WAL) in `~/millerenos/data`, app-level tenant checks (tested) |
| Mini App | `apps/miniapp` build | **same build**, same API contract (`/api/v1`) |
| Website | SSR | **same pages**, pre-rendered at deploy time by `lite/build/render-site.ts` |
| Bot | grammY | `lite/src/Bot.php`, same texts (generated `lite/src/i18n.json`) |
| Payments | Stars + USDT/TRX web checkout | Stars (USDT/TRX checkout: not yet ported) |
| AI | Anthropic provider | not configured (founder decision: on hold) |
| Background work | worker process | on each request (≤ once/min) + `/cron?key=` called by deploys |

Layout on the host:
```
~/public_html/God/         index.php, .htaccess, static site, app/ (Mini App)
~/millerenos/src/          PHP code (outside the web root; .htaccess denies all)
~/millerenos/config/app.env  written by the deploy from secrets (mode 600)
~/millerenos/data/         millerenos.sqlite + secrets.php (generated on first request; never touched by deploys)
```

Deploy: push to the branch (or run the workflow manually). Secrets: `CPANEL_USER`, `CPANEL_PASSWORD` (already set),
`MILLERENOS_BOT_TOKEN` (add once). The deploy tests (PHP 8.1 + Node), builds, uploads, smoke-tests
`/God/readyz`, and calls `/God/cron` which registers the Telegram webhook with a server-generated secret.

Tests: `php lite/tests/run.php` (70 checks: init-data, IDOR, trial abuse, quotas, orders/stock, payments replay,
webhook secret, flood limit, cron). Local preview: `lite/build/assemble.sh` + `php -S … lite/build/dev-router.php`.

Backups: download `~/millerenos/data/millerenos.sqlite` via cPanel Backup/File Manager; automated encrypted backups
are available in the VPS edition. Move to a VPS when traffic or features (AI, crypto checkout) require it — the Mini
App and data model are the same.
