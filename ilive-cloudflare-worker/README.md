# iLive Telegram Relay

Cloudflare Worker relay for sending iLive download events to Telegram when the origin server cannot reach Telegram directly.

## Deploy

Use Cloudflare's Deploy flow and provide these three secrets when prompted:

- `TG_BOT_TOKEN`: Telegram bot token from BotFather.
- `TG_CHAT_ID`: destination chat/group ID.
- `RELAY_SECRET`: a long random shared secret. Use the exact same value in the iLive admin panel.

After deployment, copy the generated `https://...workers.dev` URL into the iLive admin panel as **Cloudflare Worker URL** and enter the same `RELAY_SECRET` there.

The origin site signs each JSON event with HMAC-SHA256. The Worker verifies it before forwarding the notification to Telegram.
