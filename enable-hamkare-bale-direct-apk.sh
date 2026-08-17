#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این دستور باید با sudo/root اجرا شود.' >&2; exit 1; }
for command_name in curl flock python3 systemctl; do
  command -v "$command_name" >/dev/null || { echo "دستور لازم نصب نیست: $command_name" >&2; exit 1; }
done

exec 9>/run/lock/hamkare-bale-github-download.lock
flock -n 9 || { echo 'تنظیم دیگری در حال اجراست.' >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BOT="$SCRIPT_DIR/bot/hamkare_bot.py"
APP_DIR="${HAMKARE_APP_DIR:-/opt/hamkare-bots}"
ENV_FILE="$APP_DIR/bale.env"
BOT_TARGET="$APP_DIR/bot.py"
SERVICE=hamkare-bale.service
PUBLIC_URL='https://adlisho.online/download.php'
BACKUP_DIR="$(mktemp -d /var/backups/hamkare-bale-github-download-XXXXXXXX)"

for source in "$SOURCE_BOT" "$ENV_FILE" "$BOT_TARGET"; do
  [[ -f "$source" && ! -L "$source" ]] || { echo "فایل معتبر پیدا نشد: $source" >&2; exit 1; }
done

curl --fail --silent --show-error --location --max-time 60 --range 0-3 "$PUBLIC_URL" >/dev/null
cp -a "$ENV_FILE" "$BACKUP_DIR/bale.env"
cp -a "$BOT_TARGET" "$BACKUP_DIR/bot.py"

INSTALL_COMPLETE=0
rollback() {
  local status=$?
  if [[ $INSTALL_COMPLETE -eq 0 ]]; then
    cp -a "$BACKUP_DIR/bale.env" "$ENV_FILE" 2>/dev/null || true
    cp -a "$BACKUP_DIR/bot.py" "$BOT_TARGET" 2>/dev/null || true
    systemctl try-restart "$SERVICE" 2>/dev/null || true
    echo "تنظیم ناموفق بود؛ نسخه قبل بازگردانده شد. بکاپ: $BACKUP_DIR" >&2
  fi
  return "$status"
}
trap rollback EXIT

install -o root -g root -m 0750 "$SOURCE_BOT" "$BOT_TARGET"
python3 - "$ENV_FILE" "$PUBLIC_URL" <<'PY'
import os
import stat
import sys
import tempfile

path, public_url = sys.argv[1:]
fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    info = os.fstat(fd)
    with os.fdopen(fd, "r", encoding="utf-8", closefd=False) as source:
        lines = source.read().splitlines()
finally:
    os.close(fd)

updates = {
    "DOWNLOAD_URL": public_url,
    "APK_UPLOAD_ENABLED": "false",
    "APK_DEPLOY_PATH": "",
    "APK_STAGE_DIR": "",
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
systemctl restart "$SERVICE"
sleep 4
systemctl is-active --quiet "$SERVICE"

INSTALL_COMPLETE=1
echo '✅ دکمه دانلود بله به مسیر ثابت Adlisho متصل شد.'
echo "لینک ثابت: $PUBLIC_URL"
echo 'ربات هیچ APKای دریافت یا منتشر نمی‌کند.'
echo "بکاپ: $BACKUP_DIR"
