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
APP="${HAMKARE_APP_DIR:-/opt/hamkare-bots}"

render_service_unit() {
  local platform="$1"
  cat <<EOF
[Unit]
Description=Hamkare $platform recruitment bot
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

repair_mode() {
  [[ "$APP" =~ ^/(opt|srv)/[A-Za-z0-9._/-]+$ ]] || { echo 'HAMKARE_APP_DIR باید زیر /opt یا /srv باشد.' >&2; return 1; }
  APP="$(realpath -m -- "$APP")"
  [[ "$APP" == /opt/* || "$APP" == /srv/* ]] || { echo 'مسیر نهایی نامعتبر است.' >&2; return 1; }
  [[ -d "$APP" && -f "$APP/bot.py" ]] || { echo "نصب موجود پیدا نشد: $APP/bot.py" >&2; return 1; }

  local platform env_file key value unit desired database_path
  local shared_changed=0 env_errors=0
  local -a restart_services=()
  local -a required_keys=(PLATFORM BOT_TOKEN LOG_CHAT_ID ADMIN_IDS DOWNLOAD_URL SITE_URL SUPPORT_URL PRIVACY_URL TRACKING_URL DATABASE_PATH)

  if [[ "$(stat -c '%U:%G:%a' "$APP")" != root:root:700 ]]; then chown root:root "$APP"; chmod 0700 "$APP"; shared_changed=1; fi
  if [[ "$(stat -c '%U:%G:%a' "$APP/bot.py")" != root:root:750 ]]; then chown root:root "$APP/bot.py"; chmod 0750 "$APP/bot.py"; shared_changed=1; fi

  for platform in telegram bale; do
    env_file="$APP/$platform.env"
    if [[ ! -f "$env_file" ]]; then echo "❌ env موجود نیست؛ secret ساخته نشد: $env_file" >&2; env_errors=1; continue; fi
    if [[ "$(stat -c '%U:%G:%a' "$env_file")" != root:root:600 ]]; then chown root:root "$env_file"; chmod 0600 "$env_file"; shared_changed=1; fi
    for key in "${required_keys[@]}"; do
      value="$(sed -n "s/^${key}=//p" "$env_file" | tail -n 1)"
      if [[ -z "$value" ]]; then echo "❌ $env_file: مقدار $key ناقص است؛ فایل تغییر نکرد." >&2; env_errors=1; fi
    done
    value="$(sed -n 's/^PLATFORM=//p' "$env_file" | tail -n 1)"
    if [[ "$value" != "$platform" ]]; then echo "❌ $env_file: PLATFORM باید $platform باشد؛ فایل تغییر نکرد." >&2; env_errors=1; fi
  done
  (( env_errors == 0 )) || { echo 'Repair متوقف شد؛ token/chat ID تغییر نکرد.' >&2; return 2; }

  database_path="$(sed -n 's/^DATABASE_PATH=//p' "$APP/telegram.env" | tail -n 1)"
  [[ "$database_path" == "$APP/"* ]] || { echo "❌ DATABASE_PATH باید داخل $APP باشد." >&2; return 2; }
  value="$(sed -n 's/^DATABASE_PATH=//p' "$APP/bale.env" | tail -n 1)"
  [[ "$value" == "$database_path" ]] || { echo '❌ DATABASE_PATH دو سرویس یکسان نیست.' >&2; return 2; }
  install -d -o root -g root -m 0700 "$(dirname -- "$database_path")"
  for value in "$database_path" "$database_path-wal" "$database_path-shm" "$database_path-journal"; do
    if [[ -e "$value" && "$(stat -c '%U:%G:%a' "$value")" != root:root:600 ]]; then chown root:root "$value"; chmod 0600 "$value"; shared_changed=1; fi
  done

  for platform in telegram bale; do
    unit="/etc/systemd/system/hamkare-$platform.service"; desired="$(mktemp)"
    render_service_unit "$platform" > "$desired"
    if [[ ! -f "$unit" ]] || ! cmp -s "$desired" "$unit"; then install -o root -g root -m 0644 "$desired" "$unit"; restart_services+=("hamkare-$platform.service"); fi
    rm -f "$desired"
  done
  python3 -m py_compile "$APP/bot.py"
  find "$APP" -maxdepth 1 -type d -name __pycache__ -exec chown -R root:root {} + -exec chmod 0700 {} +
  systemctl daemon-reload

  for platform in telegram bale; do
    unit="hamkare-$platform.service"
    if (( shared_changed )) || ! systemctl is-active --quiet "$unit"; then restart_services+=("$unit"); fi
  done
  local -A seen=()
  for unit in "${restart_services[@]}"; do
    [[ -z "${seen[$unit]:-}" ]] || continue; seen[$unit]=1
    systemctl enable "$unit" >/dev/null; systemctl restart "$unit"
  done
  for platform in telegram bale; do
    unit="hamkare-$platform.service"
    systemctl is-active --quiet "$unit" || { echo "❌ health-check ناموفق: $unit" >&2; systemctl --no-pager --full status "$unit" >&2 || true; return 1; }
  done
  echo '✅ Repair امن کامل شد؛ env و secretها بازنویسی نشدند.'
}

restore_adlisho_routes() {
  [[ "$APP" =~ ^/(opt|srv)/[A-Za-z0-9._/-]+$ ]] || { echo 'HAMKARE_APP_DIR باید زیر /opt یا /srv باشد.' >&2; return 1; }
  APP="$(realpath -m -- "$APP")"
  [[ -d "$APP" && -f "$APP/telegram.env" && -f "$APP/bale.env" ]] || { echo 'نصب کامل ربات‌ها پیدا نشد.' >&2; return 1; }
  local backup
  backup="${APP}.routes-backup.$(date +%Y%m%d-%H%M%S)"
  install -d -o root -g root -m 0700 "$backup"
  cp -a "$APP/telegram.env" "$APP/bale.env" "$APP/bot.py" "$backup/"
  install -o root -g root -m 0750 "$SCRIPT_DIR/bot/hamkare_bot.py" "$APP/bot.py"
  python3 - "$APP/telegram.env" "$APP/bale.env" <<'PY'
import os
import stat
import sys
import tempfile

updates = {
    "DOWNLOAD_URL": "https://adlisho.online/download",
    "SITE_URL": "https://adlisho.online",
    "SUPPORT_URL": "https://adlisho.online/contact.html",
    "PRIVACY_URL": "https://adlisho.online/privacy.html",
    "TRACKING_URL": "https://adlisho.online/result.html",
}
for path in sys.argv[1:]:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise RuntimeError(f"unsafe env: {path}")
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as source:
            lines = source.read().splitlines()
    finally:
        os.close(descriptor)
    seen, output = set(), []
    for line in lines:
        key = line.split("=", 1)[0] if "=" in line else ""
        if key in updates:
            output.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            output.append(line)
    output.extend(f"{key}={value}" for key, value in updates.items() if key not in seen)
    fd, temporary = tempfile.mkstemp(prefix=".adlisho-routes-", dir=os.path.dirname(path))
    try:
        os.fchmod(fd, stat.S_IMODE(info.st_mode))
        os.fchown(fd, info.st_uid, info.st_gid)
        with os.fdopen(fd, "w", encoding="utf-8") as destination:
            destination.write("\n".join(output) + "\n")
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
PY
  python3 -m py_compile "$APP/bot.py"
  systemctl restart hamkare-telegram.service hamkare-bale.service
  sleep 5
  systemctl is-active --quiet hamkare-telegram.service
  systemctl is-active --quiet hamkare-bale.service
  echo '✅ سایت، تلگرام و بله به https://adlisho.online/download متصل شدند.'
  echo "✅ توکن‌ها و Chat IDها تغییر نکردند. بکاپ: $backup"
}

if [[ "${1:-}" == --repair ]]; then repair_mode; exit $?; fi
if [[ "${1:-}" == --restore-adlisho-routes ]]; then restore_adlisho_routes; exit $?; fi

SOURCE_BOT="$SCRIPT_DIR/bot/hamkare_bot.py"
[[ -f "$SOURCE_BOT" ]] || { echo "فایل بات پیدا نشد: $SOURCE_BOT" >&2; exit 1; }
BRAND_NAME="${BRAND_NAME:-همکاره}"
SITE_URL="${SITE_URL:-https://adlisho.online}"
DOWNLOAD_URL='https://adlisho.online/download'
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
  render_service_unit "$platform" > "/etc/systemd/system/hamkare-$platform.service"
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
echo 'تعویض مستقیم APK تلگرام: enable-hamkare-telegram-direct-apk.sh را روی VPS اجرا کنید؛ آپلود بله غیرفعال می‌ماند.'
echo 'بات استخدامی تلگرام و بات بله هیچ دسترسی مستقیم به فایل APK ندارند.'
[[ -z "$BACKUP" ]] || echo "بکاپ نسخه قبلی: $BACKUP"
echo 'تست: /start را از یک حساب مدیر و یک حساب کاربر عادی در هر دو بات اجرا کنید.'
