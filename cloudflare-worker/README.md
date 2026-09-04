# iLive Telegram Relay

This Worker receives HMAC-signed download events from the iLive PHP site and forwards them to Telegram Bot API.

## Cloudflare secrets
Set these as encrypted Worker secrets (never commit real values):

- `TG_BOT_TOKEN` — Telegram bot token
- `TG_CHAT_ID` — target chat/group ID
- `RELAY_SECRET` — a long random shared secret; use the exact same value in the iLive admin panel

## Git deployment
In Cloudflare Workers & Pages, import the GitHub repository `GODS313/Dev`, select branch `ilive-telegram-package`, and use `cloudflare-worker` as the root directory. Deploy the Worker, then add the three secrets above.

Copy the resulting `https://...workers.dev` URL into the iLive admin field `Cloudflare Worker URL`. Put the same `RELAY_SECRET` in the iLive admin field `Relay Secret`.

Do not put the Telegram bot token in the iLive site or in this repository.
