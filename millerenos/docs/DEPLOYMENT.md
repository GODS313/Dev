# Deployment

## Environments
| Env | Purpose | Data | Bot |
|---|---|---|---|
| development | local work | throwaway | optional test bot |
| staging | pre-release verification | synthetic only | **separate** staging bot (own token) |
| production | customers | real | production bot |

Each environment has its own database, secrets, bot token and webhook secret. Never point staging at production data.

## Requirements
- Linux host (2 vCPU / 2 GB RAM is enough to start), Docker + Compose, or Node 22 + PostgreSQL 16.
- A domain with HTTPS (Telegram Mini Apps require HTTPS). Caddy example: `ops/Caddyfile.example`.

## First deployment (Docker Compose)
1. Create `ops/.env` from `.env.example` (production values; `NODE_ENV=production`, `TRUST_PROXY=true`,
   `PUBLIC_BASE_URL=https://<domain>`), plus `POSTGRES_SUPERUSER_PASSWORD`. Generate secrets with `openssl rand -hex 32`.
2. `docker compose -f ops/docker-compose.yml up -d db`
3. Create roles and database:
   `docker compose -f ops/docker-compose.yml exec db psql -U postgres -v owner_pw=… -v app_pw=… -v system_pw=… -v backup_pw=… -v db=millerenos -f /bootstrap/bootstrap-roles.sql`
4. `docker compose -f ops/docker-compose.yml up -d --build` (runs `migrate`, then `app` and `worker`).
5. Put Caddy (or another TLS proxy) in front of `127.0.0.1:8080`.
6. Register the Telegram webhook (token and secret never leave the server shell):
   ```bash
   curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url="$PUBLIC_BASE_URL/tg/webhook" -d secret_token="$TELEGRAM_WEBHOOK_SECRET" \
     -d 'allowed_updates=["message","callback_query","pre_checkout_query"]' -d drop_pending_updates=true
   ```
7. In @BotFather: set the Mini App / menu button URL to `https://<domain>/app/`, bot description, commands
   (`start, app, plans, support, language, help, privacy`) and enable payments in Stars (no provider needed).
8. Verify: `/healthz`, `/readyz`, `/en/`, `/sitemap.xml`, `/start` in Telegram, open the Mini App, start a trial.
9. Enable backups (BACKUP_RESTORE.md) and run one restore test before inviting customers.

## Release procedure (every deploy)
1. CI green on the commit (lint, format, typecheck, build, 80 tests, audit, license check, Docker build).
2. Deploy to **staging** first; smoke test: bot `/start`, Mini App sign-in, create product, place store order, Stars checkout (Telegram test environment).
3. Production: take a backup (`systemctl start millerenos-backup`), then `docker compose … up -d --build`.
   `migrate` runs before the app starts; if it fails, the old containers keep running.
4. Health check: `/readyz` 200, error rate in logs, `http_request_duration_seconds` in `/metrics`.
5. Record the release in `CHANGELOG.md` and tag it (`git tag vX.Y.Z`).

## Rollback
- Application: redeploy the previous image/tag (`git checkout vPREV && docker compose … up -d --build app worker`).
- Migrations are forward-only. Write migrations to be backward compatible with the previous release
  (add columns nullable → backfill → enforce in a later release). If a migration itself corrupts data,
  restore from the pre-deploy backup (RUNBOOK.md → "Restore production").

## Scaling notes
The app is stateless apart from the in-memory rate limiters. Before running more than one `app` replica, move rate
limiting to Redis (`@fastify/rate-limit` supports it). Multiple `worker` replicas are already safe (`SKIP LOCKED`, dedupe keys).

## etebarami.net/God (current target)
The app supports being served under a path: set `PUBLIC_BASE_URL=https://etebarami.net/God` and every route, link,
sitemap, cookie and the Mini App live under `/God`. The reverse proxy must forward `/God…` **without stripping**
the prefix.

1. On a server with Docker (ideally the one serving etebarami.net):
   `git clone -b claude/millerenos-master-build-pbex95 https://github.com/GODS313/Dev.git /opt/millerenos-src`
   `sudo bash /opt/millerenos-src/millerenos/ops/etebarami/install.sh` — asks for the bot token (hidden), optional
   TRON address; generates all other secrets into `ops/.env` (mode 600); creates DB roles; starts db/migrate/app/worker.
2. Add the proxy rule printed by the installer to the etebarami.net web server config.
3. `sudo bash ops/etebarami/set-webhook.sh` (webhook with secret, commands, menu button → Mini App).
4. @BotFather: `/setdomain` → `etebarami.net` (website login for crypto checkout).
5. Enable backups (BACKUP_RESTORE.md).

Shared cPanel hosting without Docker/PostgreSQL cannot run this stack; use a VPS (or give the app its own small VPS
and proxy `/God` to it).

## One-command VPS install (recommended)
On an Ubuntu/Debian VPS, as root:
```bash
curl -fsSLo /tmp/millerenos.sh https://raw.githubusercontent.com/GODS313/Dev/claude/millerenos-master-build-pbex95/millerenos/ops/vps/bootstrap.sh && sudo bash /tmp/millerenos.sh
```
It installs Docker (official script) if needed, fetches the code, asks for a domain (Enter = automatic
`<ip>.sslip.io`, no DNS changes needed), asks for the bot token (hidden) and optional TRON address, generates all
other secrets, starts PostgreSQL/app/worker plus Caddy with automatic HTTPS under `/God`, registers the Telegram
webhook, and enables encrypted backups every 6 h with a weekly restore test (`ops/vps/setup-backups.sh`; the age
key is at `/root/millerenos-backup-key.txt` — copy it off the server). Re-running the same command updates the
installation and keeps data and settings. If ports 80/443 are already used by another web server, Caddy is skipped
and the installer prints the proxy rule to add.

Moving to `etebarami.net/God` later: point the domain (or a subdomain) at the VPS, change `PUBLIC_BASE_URL` in
`ops/.env`, update `ops/Caddyfile`, restart, and re-run `ops/etebarami/set-webhook.sh`.
