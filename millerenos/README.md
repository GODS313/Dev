# Millerenos

AI-powered commerce and business operating platform — **Telegram-first**.
Merchants start a 1-hour free trial in the Millerenos bot, set up a store in the Mini App, share one link, receive
orders, and draft customer replies with an AI assistant grounded in their own catalog. Plans are paid with Telegram Stars.

> Founder guide in Persian: [docs/FOUNDER_GUIDE.fa.md](docs/FOUNDER_GUIDE.fa.md)

## What is in this folder
| Path | What |
|---|---|
| `apps/server` | Node 22 + TypeScript + Fastify: API v1, admin API, Telegram bot (grammY, webhook), SEO website (SSR en/fa), worker |
| `apps/miniapp` | Telegram Mini App (Preact + Vite, ~21 KB gzipped JS) — merchant workspace + customer storefront |
| `apps/server/src/migrations` | PostgreSQL schema with row-level security per workspace |
| `ops/` | Dockerfile, docker-compose, DB role bootstrap, encrypted backup/restore scripts, systemd timers, Caddy example |
| `docs/` | Architecture, security & threat model, database, API, deployment, backups, SEO, i18n, runbook, privacy, brand, backlog |

## Quick start (development)
```bash
cd millerenos
npm ci
# PostgreSQL 16 running locally; create roles + DB (passwords are your choice):
sudo -u postgres psql -v owner_pw=dev -v app_pw=dev -v system_pw=dev -v backup_pw=dev -v db=millerenos -f ops/db/bootstrap-roles.sql
cp .env.example .env    # fill DATABASE_* URLs; bot token optional for local work
DATABASE_MIGRATION_URL=postgres://millerenos_owner:dev@localhost/millerenos npm run migrate
npm run build && npm run dev
```
Open http://localhost:8080/en/ for the site. The Mini App needs Telegram (HTTPS + bot token) — see docs/DEPLOYMENT.md.

## Quality gates
```bash
npm run lint && npm run format:check && npm run typecheck && npm run build
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres npm test   # 80 tests, real PostgreSQL
npm audit --omit=dev --audit-level=high && npm run licenses -- --check
```
CI: `.github/workflows/millerenos-ci.yml` (runs only for changes under `millerenos/`).

## Documentation
[Architecture](docs/ARCHITECTURE.md) · [Security & threat model](docs/SECURITY.md) · [Database](docs/DATABASE.md) ·
[API](docs/API.md) · [Integrations](docs/INTEGRATIONS.md) · [Deployment](docs/DEPLOYMENT.md) ·
[Backup & restore](docs/BACKUP_RESTORE.md) · [Runbook](docs/RUNBOOK.md) · [SEO](docs/SEO.md) · [i18n](docs/I18N.md) ·
[Analytics](docs/ANALYTICS.md) · [Privacy](docs/PRIVACY.md) · [Design system](docs/DESIGN_SYSTEM.md) ·
[Brand & IP](docs/BRAND.md) · [Licenses](docs/LICENSES.md) · [Backlog](docs/BACKLOG.md) · [Changelog](CHANGELOG.md)

Proprietary — all rights reserved.
