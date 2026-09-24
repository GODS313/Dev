#!/usr/bin/env bash
# Millerenos installer for etebarami.net/God on a Linux server with Docker (run as root).
# Secrets are asked with hidden prompts or generated locally — never pass them on the command line or in chat.
#
#   git clone -b claude/millerenos-master-build-pbex95 https://github.com/GODS313/Dev.git /opt/millerenos-src
#   sudo bash /opt/millerenos-src/millerenos/ops/etebarami/install.sh
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"          # …/millerenos
ENV_FILE="$ROOT/ops/.env"
PUBLIC_BASE_URL="https://etebarami.net/God"
ADMIN_IDS="8529549801"
SECURITY_CONTACT="mailto:hazratemahdi097@gmail.com"

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose v2 is required"; exit 1; }
rand() { openssl rand -hex 32; }

if [[ ! -f "$ENV_FILE" ]]; then
  echo "== Millerenos configuration =="
  read -rsp "Telegram bot token (from @BotFather, hidden): " BOT_TOKEN; echo
  [[ "$BOT_TOKEN" =~ ^[0-9]{6,12}:[A-Za-z0-9_-]{30,}$ ]] || { echo "invalid token format"; exit 1; }
  ME="$(curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getMe")" || { echo "token rejected by Telegram"; exit 1; }
  BOT_USERNAME="$(sed -E 's/.*"username":"([^"]+)".*/\1/' <<<"$ME")"
  echo "Bot: @${BOT_USERNAME}"
  read -rp "TRON receive address for USDT/TRX (T..., leave empty to disable crypto checkout): " TRON_ADDR
  if [[ -n "$TRON_ADDR" && ! "$TRON_ADDR" =~ ^T[1-9A-HJ-NP-Za-km-z]{33}$ ]]; then echo "invalid TRON address"; exit 1; fi
  read -rsp "TronGrid API key (optional, hidden): " TRONGRID_KEY; echo
  PG_SUPER="$(rand)"; OWNER_PW="$(rand)"; APP_PW="$(rand)"; SYSTEM_PW="$(rand)"; BACKUP_PW="$(rand)"
  cat >"$ENV_FILE" <<ENV
NODE_ENV=production
PORT=8080
HOST=0.0.0.0
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
TRUST_PROXY=true
LOG_LEVEL=info
POSTGRES_SUPERUSER_PASSWORD=${PG_SUPER}
DB_OWNER_PASSWORD=${OWNER_PW}
DB_APP_PASSWORD=${APP_PW}
DB_SYSTEM_PASSWORD=${SYSTEM_PW}
DB_BACKUP_PASSWORD=${BACKUP_PW}
DATABASE_URL=postgres://millerenos_app:${APP_PW}@db:5432/millerenos
DATABASE_SYSTEM_URL=postgres://millerenos_system:${SYSTEM_PW}@db:5432/millerenos
DATABASE_MIGRATION_URL=postgres://millerenos_owner:${OWNER_PW}@db:5432/millerenos
TELEGRAM_BOT_TOKEN=${BOT_TOKEN}
TELEGRAM_BOT_USERNAME=${BOT_USERNAME}
TELEGRAM_WEBHOOK_SECRET=$(rand)
PLATFORM_ADMIN_TELEGRAM_IDS=${ADMIN_IDS}
DATA_HASH_SECRET=$(rand)
AI_PROVIDER=disabled
TRON_RECEIVE_ADDRESS=${TRON_ADDR}
TRONGRID_API_KEY=${TRONGRID_KEY}
SECURITY_CONTACT=${SECURITY_CONTACT}
METRICS_TOKEN=$(rand)
ENV
  sed -i '/^TRON_RECEIVE_ADDRESS=$/d; /^TRONGRID_API_KEY=$/d' "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE (mode 600)."
fi
set -a; source "$ENV_FILE"; set +a
COMPOSE=(docker compose -f "$ROOT/ops/docker-compose.yml")

"${COMPOSE[@]}" up -d db
until "${COMPOSE[@]}" exec -T db pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done
"${COMPOSE[@]}" exec -T db psql -U postgres -q -v owner_pw="$DB_OWNER_PASSWORD" -v app_pw="$DB_APP_PASSWORD" \
  -v system_pw="$DB_SYSTEM_PASSWORD" -v backup_pw="$DB_BACKUP_PASSWORD" -v db=millerenos -f /bootstrap/bootstrap-roles.sql
"${COMPOSE[@]}" up -d --build

echo "Waiting for the app…"
for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:8080/God/readyz >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:8080/God/readyz && echo

cat <<'NEXT'

== Next: route https://etebarami.net/God to 127.0.0.1:8080 (keep the /God prefix — do not strip it) ==
nginx:   location /God { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host;
                         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto https; }
Caddy:   handle /God* { reverse_proxy 127.0.0.1:8080 }
Apache/LiteSpeed: ProxyPass /God http://127.0.0.1:8080/God  +  ProxyPassReverse /God http://127.0.0.1:8080/God
Then run:  sudo bash ops/etebarami/set-webhook.sh
NEXT
