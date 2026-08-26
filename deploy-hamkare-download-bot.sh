#!/usr/bin/env bash
# Installs the registration-free download bot (bot/hamkare_download_bot.py)
# as two systemd services, one per messenger. Separate from
# deploy-hamkare-bots.sh (the recruitment bot) and from
# deploy-hamkare-master-bot.sh (the Telegram-only control bot).
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این دستور را با root اجرا کنید.'; exit 1; }
command -v python3 >/dev/null || { apt-get update && apt-get install -y python3; }
command -v realpath >/dev/null || { echo 'realpath در دسترس نیست.' >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP="${HAMKARE_DOWNLOAD_APP_DIR:-/opt/hamkare-download-bots}"
SOURCE_BOT="$SCRIPT_DIR/bot/hamkare_download_bot.py"
[[ -f "$SOURCE_BOT" ]] || { echo "فایل بات پیدا نشد: $SOURCE_BOT" >&2; exit 1; }

SITE_URL="${SITE_URL:-https://adlisho.online}"
DOWNLOAD_URL='https://adlisho.online/download'
DL_PAGE_URL="${DL_PAGE_URL:-https://adlisho.online/dl}"
CONTENT_API_URL="${CONTENT_API_URL:-https://adlisho.online/api/download-page}"
BRAND_NAME="${BRAND_NAME:-همکاره}"

render_service_unit() {
  local platform="$1"
  cat <<EOF
[Unit]
Description=Hamkare $platform download bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$APP
EnvironmentFile=$APP/$platform.env
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

prompt_secret TG_TOKEN 'توکن ربات دانلود تلگرام (از BotFather): '
prompt_secret BALE_TOKEN 'توکن ربات دانلود بله: '

[[ "$TG_TOKEN" =~ ^[A-Za-z0-9_:-]{20,200}$ && "$BALE_TOKEN" =~ ^[A-Za-z0-9_:-]{20,200}$ ]] || {
  echo 'فرمت توکن صحیح نیست.' >&2; exit 1;
}
for url in "$SITE_URL" "$DOWNLOAD_URL" "$DL_PAGE_URL" "$CONTENT_API_URL"; do
  [[ "$url" =~ ^https://[^[:space:]]+$ ]] || { echo "لینک HTTPS معتبر نیست: $url" >&2; exit 1; }
done
[[ "$APP" =~ ^/(opt|srv)/[A-Za-z0-9._/-]+$ ]] || { echo 'HAMKARE_DOWNLOAD_APP_DIR باید زیر /opt یا /srv باشد.' >&2; exit 1; }
APP="$(realpath -m -- "$APP")"
[[ "$APP" == /opt/* || "$APP" == /srv/* ]] || { echo 'مسیر نهایی نامعتبر است.' >&2; exit 1; }

BACKUP=""
if [[ -d "$APP" ]]; then
  BACKUP="${APP}.backup.$(date +%Y%m%d-%H%M%S)"
  cp -a "$APP" "$BACKUP"
fi

install -d -m 0700 "$APP"
install -m 0750 "$SOURCE_BOT" "$APP/bot.py"

for platform_var in "telegram:$TG_TOKEN" "bale:$BALE_TOKEN"; do
  platform="${platform_var%%:*}"
  token="${platform_var#*:}"
  cat > "$APP/$platform.env" <<EOF
PLATFORM=$platform
BOT_TOKEN=$token
DOWNLOAD_URL=$DOWNLOAD_URL
DL_PAGE_URL=$DL_PAGE_URL
CONTENT_API_URL=$CONTENT_API_URL
BRAND_NAME=$BRAND_NAME
DATABASE_PATH=$APP/$platform.sqlite3
EOF
done
chmod 600 "$APP"/*.env

for platform in telegram bale; do
  render_service_unit "$platform" > "/etc/systemd/system/hamkare-download-$platform.service"
done

python3 -m py_compile "$APP/bot.py"
systemctl daemon-reload
systemctl enable --now hamkare-download-telegram.service hamkare-download-bale.service
sleep 3
systemctl is-active --quiet hamkare-download-telegram.service
systemctl is-active --quiet hamkare-download-bale.service

echo '✅ ربات‌های دانلود (بدون نیاز به ثبت‌نام) فعال شدند.'
echo "دانلود ثابت: $DOWNLOAD_URL"
echo "صفحهٔ کامل دانلود: $DL_PAGE_URL"
echo 'آدرس هر دو ربات را در تب «صفحهٔ دانلود» پنل مدیریت ثبت کنید تا روی /dl هم نمایش داده شوند.'
[[ -z "$BACKUP" ]] || echo "بکاپ نسخه قبلی: $BACKUP"
