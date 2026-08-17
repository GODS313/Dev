#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این دستور باید با sudo/root اجرا شود.' >&2; exit 1; }
for command_name in apksigner curl flock python3 systemctl; do
  command -v "$command_name" >/dev/null || { echo "دستور لازم نصب نیست: $command_name" >&2; exit 1; }
done

exec 9>/run/lock/hamkare-bale-direct-apk.lock
flock -n 9 || { echo 'فعال‌سازی دیگری در حال اجراست.' >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BOT="$SCRIPT_DIR/bot/hamkare_bot.py"
APP_DIR="${HAMKARE_APP_DIR:-/opt/hamkare-bots}"
ENV_FILE="$APP_DIR/bale.env"
BOT_TARGET="$APP_DIR/bot.py"
APK_ROOT=/var/www/seskia
APK_TARGET=$APK_ROOT/app.apk
APK_STAGE=$APK_ROOT/.hamkare-apk-staging
PUBLIC_URL='https://seskia.online/download.php?src=hamkare'
SERVICE=hamkare-bale.service
OVERRIDE_DIR=/etc/systemd/system/hamkare-bale.service.d
OVERRIDE_FILE=$OVERRIDE_DIR/apk-release.conf
BACKUP_DIR="$(mktemp -d /var/backups/hamkare-bale-direct-apk-XXXXXXXX)"

for source in "$SOURCE_BOT" "$ENV_FILE" "$BOT_TARGET" "$APK_ROOT/download.php"; do
  [[ -f "$source" && ! -L "$source" ]] || { echo "فایل معتبر پیدا نشد: $source" >&2; exit 1; }
done

cp -a "$ENV_FILE" "$BACKUP_DIR/bale.env"
cp -a "$BOT_TARGET" "$BACKUP_DIR/bot.py"
[[ ! -f "$APK_TARGET" ]] || cp -a "$APK_TARGET" "$BACKUP_DIR/app.apk"

INSTALL_COMPLETE=0
rollback() {
  local status=$?
  if [[ $INSTALL_COMPLETE -eq 0 ]]; then
    cp -a "$BACKUP_DIR/bale.env" "$ENV_FILE" 2>/dev/null || true
    cp -a "$BACKUP_DIR/bot.py" "$BOT_TARGET" 2>/dev/null || true
    systemctl daemon-reload 2>/dev/null || true
    systemctl try-restart "$SERVICE" 2>/dev/null || true
    echo "فعال‌سازی ناموفق بود؛ نسخه قبل بازگردانده شد. بکاپ: $BACKUP_DIR" >&2
  fi
  return "$status"
}
trap rollback EXIT

install -d -o root -g root -m 0700 "$APK_STAGE"
install -o root -g root -m 0750 "$SOURCE_BOT" "$BOT_TARGET"
install -d -o root -g root -m 0755 "$OVERRIDE_DIR"
printf '[Service]\nReadWritePaths=%s\n' "$APK_ROOT" > "$OVERRIDE_FILE"
chown root:root "$OVERRIDE_FILE"
chmod 0644 "$OVERRIDE_FILE"

python3 - "$ENV_FILE" "$PUBLIC_URL" "$APK_TARGET" "$APK_STAGE" <<'PY'
import os
import stat
import sys
import tempfile

path, public_url, target, stage = sys.argv[1:]
fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    info = os.fstat(fd)
    with os.fdopen(fd, "r", encoding="utf-8", closefd=False) as source:
        lines = source.read().splitlines()
finally:
    os.close(fd)

updates = {
    "DOWNLOAD_URL": public_url,
    "APK_UPLOAD_ENABLED": "true",
    "APK_DEPLOY_PATH": target,
    "APK_STAGE_DIR": stage,
    "MAX_APK_BYTES": "20971520",
    "PUBLIC_VERIFY_ENABLED": "true",
    "GITHUB_DISPATCH_TOKEN": "",
}
seen, output = set(), []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in updates:
        output.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        output.append(line)
for key, value in updates.items():
    if key not in seen:
        output.append(f"{key}={value}")

new_fd, temporary = tempfile.mkstemp(prefix=".bale-env-", dir=os.path.dirname(path))
try:
    os.fchmod(new_fd, stat.S_IMODE(info.st_mode))
    os.fchown(new_fd, info.st_uid, info.st_gid)
    with os.fdopen(new_fd, "w", encoding="utf-8") as destination:
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
systemctl restart "$SERVICE"
sleep 4
systemctl is-active --quiet "$SERVICE"
curl --fail --silent --show-error --location --max-time 30 --range 0-3 "$PUBLIC_URL" >/dev/null

INSTALL_COMPLETE=1
echo '✅ دریافت خودکار APK فورواردشده از مدیر بله فعال شد.'
echo "لینک ثابت دانلود: $PUBLIC_URL"
echo "بکاپ: $BACKUP_DIR"
echo 'تست نهایی: فایل APK سالم را به‌صورت Document برای ربات بله فوروارد کنید.'
