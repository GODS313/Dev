# Alpha Trade Telegram Bot

A Persian Telegram paper-trading bot and management landing page. Version 0.1 never sends real exchange orders.

## Bot commands

- `/price BTC` — current market price
- `/buy BTC 100` — paper buy using a USDT amount
- `/sell BTC 0.002` — paper sell using asset quantity
- `/portfolio` — balances and holdings
- `/risk 2` — per-buy risk ceiling (0.5–5%)
- `/pause` and `/resume` — emergency control

Supported assets: BTC, ETH, SOL, BNB, XRP, ADA, and DOGE.

## Secure configuration

Set the values documented in `.env.example` as hosted runtime secrets. Do not commit actual values. `TELEGRAM_ALLOWED_CHAT_IDS` is a comma-separated allowlist. Keep `TRADING_MODE=paper`.

After deployment, call `POST /api/setup/telegram` once with `Authorization: Bearer <SETUP_SECRET>`. The endpoint uses `PUBLIC_BASE_URL` to register the signed Telegram webhook. `/api/health` reports configuration presence without exposing values.

Slack alerts use an Incoming Webhook URL stored only in `SLACK_WEBHOOK_URL`. If it is absent, trades continue without alerts.

## Safety boundary

This project is an educational simulator, not investment advice. Real-money exchange adapters, withdrawals, leverage, custody, and autonomous strategies are intentionally out of scope. Review `SECURITY.md` before expanding that boundary.
