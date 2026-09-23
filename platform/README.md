# Modular management & marketing platform

A central core (users, devices, sessions, campaigns) plus separate messenger
connectors that use only each messenger's official Bot API.

## Layout
- `app/Core` – core services: `Audience` (users + messenger identities), `Devices`,
  `Sessions` (revocable, hashed tokens), `Campaigns` (queue/dispatch), `Auth`, `Audit`, `Worker`.
- `app/Connectors` – `Connector` interface, `BotApiConnector` base, `TelegramConnector`, `BaleConnector`.
  To add a messenger: implement `Connector` and register it in `Registry::all()`.
- `app/Web` – router, admin panel (Persian, RTL), webhook and device API.
- `public/` – web root (deployed to `~/public_html/panel`, served at `https://etebarami.net/panel`).
- `cli/worker.php` – worker tick: polls inbound messages, sends queued campaign messages. Runs from cron if configured, piggybacks on web requests otherwise, and is also hit by the `platform-cron` workflow.
- `migrations/` – SQL schema applied automatically on first request. Default DB is SQLite in `storage/`.

## Consent rules built in
- A messenger user is only reachable after sending `/start` to the bot; `/stop` unsubscribes.
- Every campaign message ends with the opt-out instruction.
- Users who block the bot are unsubscribed automatically.

## Secrets
Nothing secret is committed. Bot tokens are entered in the panel and stored AES-256-GCM encrypted
with a key generated on the server (`storage/app.key`). Deployment credentials live in GitHub
Actions secrets (`CPANEL_USER`, `CPANEL_PASSWORD`, `ADMIN_PASSWORD`).

## Device API
- `POST /api/v1/devices/register` with header `X-Api-Key` (shown in the panel) and JSON
  `{"device_uid": "...", "platform": "android", "model": "...", "app_version": "..."}` → `{token}`
- `POST /api/v1/devices/heartbeat` with `Authorization: Bearer <token>`
- `POST /api/v1/devices/logout`

## Local run & tests
```
php tests/run.php
STORAGE_DIR=/tmp/mp ADMIN_USER=admin ADMIN_PASSWORD=change-me-please php -S 127.0.0.1:8000 -t public public/index.php
```
