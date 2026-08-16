#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این دستور را با root اجرا کنید.'; exit 1; }
if ! command -v python3 >/dev/null; then
  apt-get update
  apt-get install -y python3
fi
command -v realpath >/dev/null || { echo 'realpath در دسترس نیست.' >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BOT="$SCRIPT_DIR/bot/hamkare_bot.py"
[[ -f "$SOURCE_BOT" ]] || { echo "فایل بات پیدا نشد: $SOURCE_BOT" >&2; exit 1; }

APP="${HAMKARE_APP_DIR:-/opt/hamkare-bots}"
BRAND_NAME="${BRAND_NAME:-همکاره}"
SITE_URL="${SITE_URL:-https://adlisho.online}"
DOWNLOAD_URL="${HAMKARE_DOWNLOAD_URL:-https://seskia.online/est/download}"
SUPPORT_URL="${SUPPORT_URL:-https://adlisho.online/contact.html}"
PRIVACY_URL="${PRIVACY_URL:-https://adlisho.online/privacy.html}"
TRACKING_URL="${TRACKING_URL:-https://adlisho.online/result.html}"
TELEGRAM_BOT_USERNAME="${TELEGRAM_BOT_USERNAME:-Pasokh313e_bot}"
BALE_BOT_USERNAME="${BALE_BOT_USERNAME:-Hamkarebot}"
MAX_APK_BYTES="${MAX_APK_BYTES:-20971520}"

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

prompt_secret TG_TOKEN "توکن تلگرام @${TELEGRAM_BOT_USERNAME}: "
prompt_value TG_LOG 'آیدی عددی گروه گزارش تلگرام (معمولاً با -100): '
prompt_value TG_ADMIN_IDS 'آیدی عددی مدیران تلگرام (با کاما جدا کنید): '
prompt_secret BALE_TOKEN "توکن بله @${BALE_BOT_USERNAME}: "
prompt_value BALE_LOG 'آیدی عددی گروه گزارش بله: '
prompt_value BALE_ADMIN_IDS 'آیدی عددی مدیران بله (با کاما جدا کنید): '

[[ "$TG_TOKEN" =~ ^[A-Za-z0-9_:-]{20,200}$ && "$BALE_TOKEN" =~ ^[A-Za-z0-9_:-]{20,200}$ ]] || {
  echo 'فرمت توکن صحیح نیست.' >&2; exit 1;
}
[[ "$TG_LOG" =~ ^-?[0-9]+$ && "$BALE_LOG" =~ ^-?[0-9]+$ ]] || {
  echo 'آیدی گروه باید عددی باشد.' >&2; exit 1;
}
[[ "$TG_ADMIN_IDS" =~ ^[0-9]+(,[0-9]+)*$ && "$BALE_ADMIN_IDS" =~ ^[0-9]+(,[0-9]+)*$ ]] || {
  echo 'آیدی مدیران باید عددی و با کاما جدا شده باشد.' >&2; exit 1;
}
[[ "$TELEGRAM_BOT_USERNAME" =~ ^[A-Za-z0-9_]{5,32}$ ]] || { echo 'نام کاربری تلگرام معتبر نیست.' >&2; exit 1; }
[[ "$BALE_BOT_USERNAME" =~ ^[A-Za-z0-9_]{5,32}$ ]] || { echo 'نام کاربری بله معتبر نیست.' >&2; exit 1; }
[[ "$MAX_APK_BYTES" =~ ^[0-9]+$ && "$MAX_APK_BYTES" -ge 1048576 && "$MAX_APK_BYTES" -le 20971520 ]] || { echo 'MAX_APK_BYTES باید بین 1 و 20 مگابایت باشد.' >&2; exit 1; }
[[ "$APP" =~ ^/(opt|srv)/[A-Za-z0-9._/-]+$ ]] || { echo 'HAMKARE_APP_DIR باید مسیر امنی زیر /opt یا /srv باشد.' >&2; exit 1; }
APP="$(realpath -m -- "$APP")"
[[ "$APP" == /opt/* || "$APP" == /srv/* ]] || { echo 'مسیر نهایی HAMKARE_APP_DIR باید زیر /opt یا /srv باشد.' >&2; exit 1; }

for url in "$SITE_URL" "$DOWNLOAD_URL" "$SUPPORT_URL" "$PRIVACY_URL" "$TRACKING_URL"; do
  [[ "$url" =~ ^https://[^[:space:]]+$ ]] || { echo "لینک HTTPS معتبر نیست: $url" >&2; exit 1; }
done
[[ "$BRAND_NAME" != *$'\n'* && ${#BRAND_NAME} -le 50 ]] || { echo 'نام برند معتبر نیست.' >&2; exit 1; }

BACKUP=""
if [[ -d "$APP" ]]; then
  BACKUP="${APP}.backup.$(date +%Y%m%d-%H%M%S)"
  cp -a "$APP" "$BACKUP"
fi

install -d -m 0700 "$APP"
install -m 0750 "$SOURCE_BOT" "$APP/bot.py"

cat > "$APP/telegram.env" <<EOF
PLATFORM=telegram
BOT_TOKEN=$TG_TOKEN
LOG_CHAT_ID=$TG_LOG
ADMIN_IDS=$TG_ADMIN_IDS
BRAND_NAME=$BRAND_NAME
DOWNLOAD_URL=$DOWNLOAD_URL
SITE_URL=$SITE_URL
SUPPORT_URL=$SUPPORT_URL
PRIVACY_URL=$PRIVACY_URL
TRACKING_URL=$TRACKING_URL
DATABASE_PATH=$APP/hamkare.sqlite3
APK_UPLOAD_ENABLED=false
APK_DEPLOY_PATH=
APK_STAGE_DIR=
MAX_APK_BYTES=$MAX_APK_BYTES
PUBLIC_VERIFY_ENABLED=false
EOF

cat > "$APP/bale.env" <<EOF
PLATFORM=bale
BOT_TOKEN=$BALE_TOKEN
LOG_CHAT_ID=$BALE_LOG
ADMIN_IDS=$BALE_ADMIN_IDS
BRAND_NAME=$BRAND_NAME
DOWNLOAD_URL=$DOWNLOAD_URL
SITE_URL=$SITE_URL
SUPPORT_URL=$SUPPORT_URL
PRIVACY_URL=$PRIVACY_URL
TRACKING_URL=$TRACKING_URL
DATABASE_PATH=$APP/hamkare.sqlite3
APK_UPLOAD_ENABLED=false
APK_DEPLOY_PATH=
APK_STAGE_DIR=
MAX_APK_BYTES=$MAX_APK_BYTES
PUBLIC_VERIFY_ENABLED=false
EOF
chmod 600 "$APP"/*.env

for platform in telegram bale; do
  read_write_paths="$APP"
  cat > "/etc/systemd/system/hamkare-$platform.service" <<EOF
[Unit]
Description=Hamkare $platform recruitment bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
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
ReadWritePaths=$read_write_paths

[Install]
WantedBy=multi-user.target
EOF
done

python3 -m py_compile "$APP/bot.py"
systemctl daemon-reload
systemctl enable --now hamkare-telegram.service hamkare-bale.service
sleep 3
systemctl is-active --quiet hamkare-telegram.service
systemctl is-active --quiet hamkare-bale.service

echo '✅ هر دو بات وایت‌لیبل همکاره فعال شدند.'
echo "تلگرام: https://t.me/$TELEGRAM_BOT_USERNAME"
echo "بله: https://ble.ir/$BALE_BOT_USERNAME"
echo "دانلود ثابت: $DOWNLOAD_URL"
echo 'تعویض فایل APK: فقط از پنل امن https://seskia.online/admin.php یا بات اختصاصی آپلود Seskia'
echo 'بات استخدامی تلگرام و بات بله هیچ دسترسی مستقیم به فایل APK ندارند.'
[[ -z "$BACKUP" ]] || echo "بکاپ نسخه قبلی: $BACKUP"
echo 'تست: /start را از یک حساب مدیر و یک حساب کاربر عادی در هر دو بات اجرا کنید.'
