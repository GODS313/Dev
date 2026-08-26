#!/usr/bin/env bash
# Installs the Telegram-only master control bot (bot/hamkare_master_bot.py).
# This bot talks straight to Cloudflare's D1 and R2 HTTP APIs -- it needs no
# access to adlisho.online at all, which is the whole point: it is the
# fallback control path when the website itself is filtered or down.
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این دستور را با root اجرا کنید.'; exit 1; }
command -v python3 >/dev/null || { apt-get update && apt-get install -y python3; }
command -v realpath >/dev/null || { echo 'realpath در دسترس نیست.' >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP="${HAMKARE_MASTER_APP_DIR:-/opt/hamkare-master-bot}"
SOURCE_BOT="$SCRIPT_DIR/bot/hamkare_master_bot.py"
[[ -f "$SOURCE_BOT" ]] || { echo "فایل بات پیدا نشد: $SOURCE_BOT" >&2; exit 1; }

SITE_URL="${SITE_URL:-https://adlisho.online}"

render_service_unit() {
  cat <<EOF
[Unit]
Description=Hamkare master control bot (Telegram)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$APP
EnvironmentFile=$APP/master.env
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 -I $APP/bot.py
Restart=always
RestartSec=3
TimeoutStopSec=20
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectHostname=true
ProtectClock=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictRealtime=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=$APP

[Install]
WantedBy=multi-user.target
EOF
}

prompt_secret() {
  local variable_name="$1" prompt="$2" value="${!1:-}"
  if [[ -z "$value" ]]; then read -rsp "$prompt" value; echo; fi
  printf -v "$variable_name" '%s' "$value"
}
prompt_value() {
  local variable_name="$1" prompt="$2" value="${!1:-}"
  if [[ -z "$value" ]]; then read -rp "$prompt" value; fi
  printf -v "$variable_name" '%s' "$value"
}

prompt_secret MASTER_BOT_TOKEN 'توکن ربات مادر تلگرام (از BotFather، جدا از بات‌های دیگر): '
prompt_value MASTER_ADMIN_IDS 'آیدی عددی مدیران مجاز (با کاما جدا کنید): '
prompt_value CF_ACCOUNT_ID 'Cloudflare Account ID: '
prompt_value CF_D1_DATABASE_ID 'شناسهٔ دیتابیس D1 (همان دیتابیس متصل به Pages): '
prompt_secret CF_API_TOKEN 'توکن Cloudflare با دسترسی D1 Edit روی این account: '
prompt_value R2_BUCKET 'نام باکت R2 رسانه (همان MEDIA binding در Pages): '
prompt_value R2_ACCESS_KEY_ID 'R2 Access Key ID: '
prompt_secret R2_SECRET_ACCESS_KEY 'R2 Secret Access Key: '

[[ "$MASTER_BOT_TOKEN" =~ ^[A-Za-z0-9_:-]{20,200}$ ]] || { echo 'فرمت توکن ربات مادر صحیح نیست.' >&2; exit 1; }
[[ "$MASTER_ADMIN_IDS" =~ ^[0-9]+(,[0-9]+)*$ ]] || { echo 'آیدی مدیران باید عددی و با کاما جدا شده باشد.' >&2; exit 1; }
for value in "$CF_ACCOUNT_ID" "$CF_D1_DATABASE_ID" "$CF_API_TOKEN" "$R2_BUCKET" "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY"; do
  [[ -n "$value" ]] || { echo 'همهٔ مقادیر Cloudflare/R2 الزامی هستند.' >&2; exit 1; }
done
[[ "$SITE_URL" =~ ^https://[^[:space:]]+$ ]] || { echo "لینک HTTPS معتبر نیست: $SITE_URL" >&2; exit 1; }
[[ "$APP" =~ ^/(opt|srv)/[A-Za-z0-9._/-]+$ ]] || { echo 'HAMKARE_MASTER_APP_DIR باید زیر /opt یا /srv باشد.' >&2; exit 1; }
APP="$(realpath -m -- "$APP")"
[[ "$APP" == /opt/* || "$APP" == /srv/* ]] || { echo 'مسیر نهایی نامعتبر است.' >&2; exit 1; }

BACKUP=""
if [[ -d "$APP" ]]; then
  BACKUP="${APP}.backup.$(date +%Y%m%d-%H%M%S)"
  cp -a "$APP" "$BACKUP"
fi

install -d -m 0700 "$APP"
install -m 0750 "$SOURCE_BOT" "$APP/bot.py"

cat > "$APP/master.env" <<EOF
MASTER_BOT_TOKEN=$MASTER_BOT_TOKEN
MASTER_ADMIN_IDS=$MASTER_ADMIN_IDS
CF_ACCOUNT_ID=$CF_ACCOUNT_ID
CF_D1_DATABASE_ID=$CF_D1_DATABASE_ID
CF_API_TOKEN=$CF_API_TOKEN
R2_BUCKET=$R2_BUCKET
R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
SITE_URL=$SITE_URL
DATABASE_PATH=$APP/state.sqlite3
EOF
chmod 600 "$APP/master.env"

render_service_unit > /etc/systemd/system/hamkare-master-bot.service

python3 -m py_compile "$APP/bot.py"
systemctl daemon-reload
systemctl enable --now hamkare-master-bot.service
sleep 3
systemctl is-active --quiet hamkare-master-bot.service

echo '✅ ربات مادر فعال شد.'
echo 'برای شروع، از یک حساب مدیر مجاز در تلگرام /panel را بفرستید.'
echo 'این ربات مستقیم روی Cloudflare می‌نویسد؛ حتی اگر adlisho.online در دسترس نباشد کار می‌کند.'
[[ -z "$BACKUP" ]] || echo "بکاپ نسخه قبلی: $BACKUP"
