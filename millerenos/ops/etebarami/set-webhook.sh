#!/usr/bin/env bash
# Registers the Telegram webhook and bot commands once https://etebarami.net/God/readyz works publicly.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
set -a; source "$ROOT/ops/.env"; set +a
curl -fsS "${PUBLIC_BASE_URL}/readyz" >/dev/null || { echo "${PUBLIC_BASE_URL}/readyz is not reachable over HTTPS yet"; exit 1; }
API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"
curl -fsS "$API/setWebhook" --data-urlencode "url=${PUBLIC_BASE_URL}/tg/webhook" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","callback_query","pre_checkout_query"]' -d drop_pending_updates=true; echo
curl -fsS "$API/setMyCommands" -H 'content-type: application/json' -d '{"commands":[
 {"command":"start","description":"Main menu"},{"command":"app","description":"Open Millerenos"},
 {"command":"plans","description":"Plans & pricing"},{"command":"support","description":"Support"},
 {"command":"language","description":"Language"},{"command":"privacy","description":"Privacy"}]}'; echo
curl -fsS "$API/setChatMenuButton" -H 'content-type: application/json' \
  -d "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"Millerenos\",\"web_app\":{\"url\":\"${PUBLIC_BASE_URL}/app/\"}}}"; echo
curl -fsS "$API/getWebhookInfo"; echo
echo "Done. In @BotFather also run /setdomain → etebarami.net (needed for website login / crypto checkout)."
