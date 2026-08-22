#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این دستور باید با sudo/root اجرا شود.' >&2; exit 1; }
for command_name in flock python3 realpath stat systemctl; do
  command -v "$command_name" >/dev/null || { echo "دستور لازم نصب نیست: $command_name" >&2; exit 1; }
done

exec 9>/run/lock/hamkare-telegram-direct-apk.lock
flock -n 9 || { echo 'تنظیم دیگری هم‌زمان در حال اجراست.' >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BOT="$SCRIPT_DIR/bot/hamkare_bot.py"
SOURCE_BANNER="$SCRIPT_DIR/assets/hamkare-bot-banner.png"
APP_DIR="${HAMKARE_APP_DIR:-/opt/hamkare-bots}"
TELEGRAM_ENV="$APP_DIR/telegram.env"
BOT_TARGET="$APP_DIR/bot.py"
APK_ROOT=/var/www/adlisho
APK_TARGET=$APK_ROOT/app.apk
APK_STAGE=$APK_ROOT/.hamkare-apk-staging
BANNER_TARGET=$APK_ROOT/hamkare-bot-banner.png
PUBLIC_URL=https://adlisho.online/download
ALLOWED_CHAT_IDS="${APK_ALLOWED_CHAT_IDS:--1004315509328}"
OVERRIDE_DIR=/etc/systemd/system/hamkare-telegram.service.d
OVERRIDE_FILE=$OVERRIDE_DIR/apk-direct.conf
BACKUP_DIR="$(mktemp -d /var/backups/hamkare-telegram-direct-apk-XXXXXXXX)"

[[ "$ALLOWED_CHAT_IDS" =~ ^-100[0-9]{7,26}(,-100[0-9]{7,26})*$ ]] || { echo 'Chat ID گروه تلگرام معتبر نیست.' >&2; exit 1; }

for source in "$SOURCE_BOT" "$SOURCE_BANNER" "$TELEGRAM_ENV" "$BOT_TARGET"; do
  [[ -f "$source" && ! -L "$source" ]] || { echo "فایل معتبر پیدا نشد: $source" >&2; exit 1; }
done
[[ -d "$APK_ROOT" && ! -L "$APK_ROOT" && "$(realpath -e -- "$APK_ROOT")" == "$APK_ROOT" ]] || {
  echo 'مسیر امن APK روی سرور پیدا نشد.' >&2; exit 1;
}
[[ -f "$APK_ROOT/download.php" && ! -L "$APK_ROOT/download.php" ]] || {
  echo 'درگاه مستقیم APK روی سرور پیدا نشد.' >&2; exit 1;
}

cp -a "$TELEGRAM_ENV" "$BOT_TARGET" "$BACKUP_DIR/"
[[ ! -f "$OVERRIDE_FILE" ]] || cp -a "$OVERRIDE_FILE" "$BACKUP_DIR/apk-direct.conf"
[[ ! -f "$BANNER_TARGET" ]] || cp -a "$BANNER_TARGET" "$BACKUP_DIR/hamkare-bot-banner.png"
BANNER_EXISTED=0
[[ ! -f "$BANNER_TARGET" ]] || BANNER_EXISTED=1
OVERRIDE_EXISTED=0
[[ ! -f "$OVERRIDE_FILE" ]] || OVERRIDE_EXISTED=1
INSTALL_COMPLETE=0
rollback() {
  local status=$?
  if [[ $INSTALL_COMPLETE -eq 0 ]]; then
    cp -a "$BACKUP_DIR/telegram.env" "$TELEGRAM_ENV" 2>/dev/null || true
    cp -a "$BACKUP_DIR/bot.py" "$BOT_TARGET" 2>/dev/null || true
    if [[ $BANNER_EXISTED -eq 1 ]]; then
      cp -a "$BACKUP_DIR/hamkare-bot-banner.png" "$BANNER_TARGET" 2>/dev/null || true
    else
      rm -f -- "$BANNER_TARGET"
    fi
    if [[ $OVERRIDE_EXISTED -eq 1 ]]; then
      cp -a "$BACKUP_DIR/apk-direct.conf" "$OVERRIDE_FILE" 2>/dev/null || true
    else
      rm -f -- "$OVERRIDE_FILE"
    fi
    systemctl daemon-reload 2>/dev/null || true
    systemctl try-restart hamkare-telegram.service 2>/dev/null || true
    echo "تنظیم ناموفق بود؛ نسخه قبلی بازگردانده شد. بکاپ: $BACKUP_DIR" >&2
  fi
  return "$status"
}
trap rollback EXIT

install -d -o www-data -g www-data -m 0700 "$APK_STAGE"
[[ ! -L "$APK_STAGE/publish.lock" ]] || { echo 'قفل انتشار APK معتبر نیست.' >&2; exit 1; }
touch "$APK_STAGE/publish.lock"
chown www-data:www-data "$APK_STAGE/publish.lock"
chmod 0600 "$APK_STAGE/publish.lock"
BOT_UID="$(stat -c %u -- "$BOT_TARGET")"
BOT_GID="$(stat -c %g -- "$BOT_TARGET")"
BOT_MODE="$(stat -c %a -- "$BOT_TARGET")"
install -o "$BOT_UID" -g "$BOT_GID" -m "$BOT_MODE" "$SOURCE_BOT" "$BOT_TARGET"
install -o root -g root -m 0644 "$SOURCE_BANNER" "$BANNER_TARGET"
install -d -o root -g root -m 0755 "$OVERRIDE_DIR"
cat >"$OVERRIDE_FILE" <<EOF
[Service]
ReadWritePaths=$APK_ROOT
EOF
chmod 0644 "$OVERRIDE_FILE"

python3 - "$TELEGRAM_ENV" "$PUBLIC_URL" "$APK_TARGET" "$APK_STAGE" "$ALLOWED_CHAT_IDS" <<'PY'
import os
import stat
import sys
import tempfile

path, public_url, apk_target, apk_stage, allowed_chat_ids = sys.argv[1:]
updates = {
    "LOG_CHAT_ID": allowed_chat_ids.split(",", 1)[0],
    "APK_ALLOWED_CHAT_IDS": allowed_chat_ids,
    "DOWNLOAD_URL": public_url,
    "APK_UPLOAD_ENABLED": "true",
    "APK_DEPLOY_PATH": apk_target,
    "APK_STAGE_DIR": apk_stage,
    "MAX_APK_BYTES": "20971520",
    "PUBLIC_VERIFY_ENABLED": "true",
}
descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    info = os.fstat(descriptor)
    if not stat.S_ISREG(info.st_mode):
        raise RuntimeError(f"unsafe env file: {path}")
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
fd, temporary = tempfile.mkstemp(prefix=".hamkare-direct-", dir=os.path.dirname(path))
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

python3 -m py_compile "$BOT_TARGET"
systemctl daemon-reload
systemctl restart hamkare-telegram.service
sleep 4
systemctl is-active --quiet hamkare-telegram.service

BOT_TOKEN="$(sed -n 's/^BOT_TOKEN=//p' "$TELEGRAM_ENV" | tail -n 1)"
python3 - "$BOT_TOKEN" "$ALLOWED_CHAT_IDS" <<'PY'
import json
import sys
import urllib.request

token, raw_chat_ids = sys.argv[1:]
for chat_id in raw_chat_ids.split(","):
    for method, payload in (
        ("getChat", {"chat_id": chat_id}),
        ("sendMessage", {
            "chat_id": chat_id,
            "text": "✅ اتصال گزارش و دریافت APK همکاره فعال شد. از این پس هر عضو همین گروه می‌تواند فایل APK را به‌صورت Document ارسال یا فوروارد کند.",
            "disable_web_page_preview": True,
        }),
    ):
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/{method}",
            data=json.dumps(payload, ensure_ascii=False).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.load(response)
        if not result.get("ok"):
            raise RuntimeError(f"Telegram rejected {method}")
PY
unset BOT_TOKEN

INSTALL_COMPLETE=1
echo "✅ دریافت APK از گروه $ALLOWED_CHAT_IDS برای همه اعضای همان گروه فعال شد."
echo '✅ تنظیمات و سرویس بله تغییر نکرد.'
echo "✅ لینک ثابت سایت، تلگرام و بله: $PUBLIC_URL"
echo "✅ بکاپ قابل بازگشت: $BACKUP_DIR"
echo "تست نهایی: یک APK را داخل گروه $ALLOWED_CHAT_IDS به‌صورت Document ارسال یا فوروارد کنید."
