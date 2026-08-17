#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این فعال‌ساز باید با sudo/root اجرا شود.' >&2; exit 1; }
for required in flock python3 realpath systemctl; do
  command -v "$required" >/dev/null || { echo "دستور لازم موجود نیست: $required" >&2; exit 1; }
done
PLATFORM=telegram
if [[ "${1:-}" == "--platform" ]]; then PLATFORM="${2:-}"; shift 2; fi
[[ "$PLATFORM" == telegram || "$PLATFORM" == bale ]] || { echo 'پلتفرم باید telegram یا bale باشد.' >&2; exit 1; }

exec 9>/run/lock/hamkare-apk-release.lock
flock -n 9 || { echo 'فعال‌سازی دیگری هم‌زمان در حال اجراست.' >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_BOT="$SCRIPT_DIR/bot/hamkare_bot.py"
SOURCE_OVERRIDE="$SCRIPT_DIR/systemd/hamkare-telegram-apk-release.conf"
APP_DIR="${HAMKARE_APP_DIR:-/opt/hamkare-bots}"
ENV_FILE="$APP_DIR/$PLATFORM.env"
BOT_TARGET="$APP_DIR/bot.py"
APK_ROOT=/var/www/seskia
APK_TARGET=$APK_ROOT/app.apk
APK_STAGE=$APK_ROOT/.hamkare-apk-staging
SERVICE="hamkare-$PLATFORM.service"
OVERRIDE_DIR="/etc/systemd/system/$SERVICE.d"
OVERRIDE_FILE=$OVERRIDE_DIR/apk-release.conf
BACKUP_DIR="$(mktemp -d "/var/backups/hamkare-$PLATFORM-apk-release-XXXXXXXX")"

for source in "$SOURCE_BOT" "$SOURCE_OVERRIDE"; do
  [[ -f "$source" && ! -L "$source" ]] || { echo "فایل منبع معتبر نیست: $source" >&2; exit 1; }
done
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || { echo "$PLATFORM.env امن پیدا نشد: $ENV_FILE" >&2; exit 1; }
[[ -f "$BOT_TARGET" && ! -L "$BOT_TARGET" ]] || { echo "bot.py امن پیدا نشد: $BOT_TARGET" >&2; exit 1; }
[[ -d "$APK_ROOT" && ! -L "$APK_ROOT" && "$(realpath -e -- "$APK_ROOT")" == "$APK_ROOT" ]] || {
  echo 'مسیر امن Seskia پیدا نشد.' >&2; exit 1;
}
[[ -f "$APK_ROOT/download.php" && ! -L "$APK_ROOT/download.php" ]] || {
  echo 'download.php محلی Seskia برای منبع موقت GitHub پیدا نشد.' >&2; exit 1;
}

GITHUB_DISPATCH_TOKEN="${GITHUB_DISPATCH_TOKEN:-}"
if [[ -z "$GITHUB_DISPATCH_TOKEN" ]]; then
  read -rsp 'GitHub fine-grained token با Actions: write را وارد کنید: ' GITHUB_DISPATCH_TOKEN
  echo
fi
[[ "$GITHUB_DISPATCH_TOKEN" =~ ^[A-Za-z0-9_]{40,255}$ ]] || {
  echo 'فرمت GitHub token معتبر نیست.' >&2; exit 1;
}

workflow_api=https://api.github.com/repos/GODS313/Dev/actions/workflows/publish-hamkare-apk.yml
BRIDGE_TOKEN="$GITHUB_DISPATCH_TOKEN" python3 - "$workflow_api" <<'PY'
import os
import sys
import urllib.request

request = urllib.request.Request(
    sys.argv[1],
    headers={
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {os.environ['BRIDGE_TOKEN']}",
        "User-Agent": "HamkareReleaseEnable/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
    },
)
with urllib.request.urlopen(request, timeout=30) as response:
    if response.status != 200:
        raise RuntimeError(f"workflow lookup returned HTTP {response.status}")
PY

cp -a "$ENV_FILE" "$BACKUP_DIR/$PLATFORM.env"
cp -a "$BOT_TARGET" "$BACKUP_DIR/bot.py"
HAD_OVERRIDE=0
if [[ -f "$OVERRIDE_FILE" && ! -L "$OVERRIDE_FILE" ]]; then
  HAD_OVERRIDE=1
  cp -a "$OVERRIDE_FILE" "$BACKUP_DIR/apk-release.conf"
elif [[ -e "$OVERRIDE_FILE" || -L "$OVERRIDE_FILE" ]]; then
  echo 'systemd override فعلی امن نیست.' >&2
  exit 1
fi

INSTALL_COMPLETE=0
rollback_enable() {
  local exit_code=$?
  if [[ $INSTALL_COMPLETE -eq 0 ]]; then
    cp -a "$BACKUP_DIR/$PLATFORM.env" "$ENV_FILE" 2>/dev/null || true
    cp -a "$BACKUP_DIR/bot.py" "$BOT_TARGET" 2>/dev/null || true
    if [[ $HAD_OVERRIDE -eq 1 ]]; then
      cp -a "$BACKUP_DIR/apk-release.conf" "$OVERRIDE_FILE" 2>/dev/null || true
    else
      rm -f -- "$OVERRIDE_FILE"
    fi
    systemctl daemon-reload 2>/dev/null || true
    systemctl try-restart "$SERVICE" 2>/dev/null || true
    echo "فعال‌سازی ناموفق بود و نسخه قبلی بازگردانده شد. بکاپ: $BACKUP_DIR" >&2
  fi
  return "$exit_code"
}
trap rollback_enable EXIT

install -d -o root -g root -m 0700 "$APK_STAGE"
install -o root -g root -m 0750 "$SOURCE_BOT" "$BOT_TARGET"
install -d -o root -g root -m 0755 "$OVERRIDE_DIR"
install -o root -g root -m 0644 "$SOURCE_OVERRIDE" "$OVERRIDE_FILE"

BRIDGE_TOKEN="$GITHUB_DISPATCH_TOKEN" python3 - "$ENV_FILE" <<'PY'
import os
import stat
import sys
import tempfile

path = sys.argv[1]
descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    info = os.fstat(descriptor)
    if not stat.S_ISREG(info.st_mode):
        raise RuntimeError("platform env is not a regular file")
    with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as source:
        lines = source.read().splitlines()
finally:
    os.close(descriptor)

updates = {
    "APK_UPLOAD_ENABLED": "true",
    "APK_DEPLOY_PATH": "/var/www/seskia/app.apk",
    "APK_STAGE_DIR": "/var/www/seskia/.hamkare-apk-staging",
    "MAX_APK_BYTES": "20971520",
    "PUBLIC_VERIFY_ENABLED": "true",
    "GITHUB_DISPATCH_TOKEN": os.environ["BRIDGE_TOKEN"],
    "GITHUB_REPOSITORY": "GODS313/Dev",
    "GITHUB_WORKFLOW": "publish-hamkare-apk.yml",
    "APK_SOURCE_URL": "https://seskia.online/download.php?src=github-release",
    "RELEASE_WAIT_SECONDS": "300",
}
seen = set()
output = []
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

fd, temporary = tempfile.mkstemp(prefix=".hamkare-env-", dir=os.path.dirname(path))
try:
    os.fchmod(fd, stat.S_IMODE(info.st_mode))
    os.fchown(fd, info.st_uid, info.st_gid)
    with os.fdopen(fd, "w", encoding="utf-8") as destination:
        destination.write("\n".join(output) + "\n")
        destination.flush()
        os.fsync(destination.fileno())
    os.replace(temporary, path)
finally:
    try:
        os.close(fd)
    except OSError:
        pass
    if os.path.exists(temporary):
        os.unlink(temporary)
PY
unset GITHUB_DISPATCH_TOKEN BRIDGE_TOKEN

python3 -m py_compile "$BOT_TARGET"
systemctl daemon-reload
systemctl restart "$SERVICE"
systemctl is-active --quiet "$SERVICE"

INSTALL_COMPLETE=1
echo "✅ آپلود اضطراری مدیر $PLATFORM به GitHub Release متصل شد."
echo '✅ دکمه بله، تلگرام و سایت: https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk'
echo "فقط $PLATFORM.env و سرویس $SERVICE تغییر کردند."
echo "بکاپ: $BACKUP_DIR"
echo "تست نهایی: در $PLATFORM با حساب مدیر، پنل مدیریت ← تعویض فایل APK را انتخاب کنید."
