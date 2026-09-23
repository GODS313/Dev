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

## Reach features
- Bulk-import your own contacts from CSV/TSV (name, phone, email, tags) on the Users page; phones are normalized and de-duplicated.
- Fast multi-term search across name, phone, email and tags.
- Campaigns can target opted-in private chats OR the groups/channels the bot belongs to.
- Join button: post an invite with an inline start link into every group/channel the bot is in.
- Business auto-reply: one reply per customer per day from a Telegram Business-connected account.

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

## Tasks (modular automation)
- `app/Tasks/` holds independent task modules. Each has its own settings, enable
  flag, secret, run state and log. Add task #2/#3 by implementing `Task` and
  registering it in `Tasks\Registry` — no rewrite of the others.
- **Task #1 — Build APK publish** (`BuildApkTask`): fetches a finished, signed APK
  from a configured URL and publishes it to the download site over a signed
  server-to-server API, then delivers the link (optionally to a Telegram chat the
  bot may post to). Runs advance in resumable steps, recover after restart, skip
  an already-published file, and never log secrets.
- **Not possible (Telegram limitation):** a bot cannot drive another bot's panel,
  press its buttons, or receive its files via the Bot API. That flow is replaced
  by the server-to-server publish API above.

### /x/ receiver
`xsite/publish.php` and `xsite/dl.php` deploy to `public_html/x/`. `publish.php`
verifies an HMAC signature using `XBUILD_SECRET` read from the panel's protected
`platform/config/app.env` (no secret lives in the web root), stores the APK under
`x/releases/` and writes `latest.json`. `dl.php` serves the newest release; point
the public download button at `/x/dl.php` to always hand out the latest build.
