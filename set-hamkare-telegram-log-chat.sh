#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این دستور باید با root اجرا شود.' >&2; exit 1; }

APP_DIR="${HAMKARE_APP_DIR:-/opt/hamkare-bots}"
CHAT_ID="${HAMKARE_TELEGRAM_LOG_CHAT_ID:--1004315509328}"
TG_ENV="$APP_DIR/telegram.env"
WEB_NOTIFY=/etc/hamkare-web-notify.json
PANEL_CONFIG=/var/lib/hamkare-apk-panel/config.json
LOCK_FILE=/run/lock/hamkare-telegram-log-chat.lock
BACKUP_DIR="/var/backups/hamkare-telegram-log-chat-$(date +%Y%m%d-%H%M%S)"

[[ "$CHAT_ID" =~ ^-100[0-9]{7,26}$ ]] || { echo 'Chat ID گروه تلگرام معتبر نیست.' >&2; exit 1; }
[[ -f "$TG_ENV" && ! -L "$TG_ENV" ]] || { echo "telegram.env امن پیدا نشد: $TG_ENV" >&2; exit 1; }
command -v flock >/dev/null || { echo 'flock نصب نیست.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'python3 نصب نیست.' >&2; exit 1; }
command -v systemctl >/dev/null || { echo 'systemctl نصب نیست.' >&2; exit 1; }

exec 9>"$LOCK_FILE"
flock -n 9 || { echo 'تغییر دیگری هم‌زمان در حال اجراست.' >&2; exit 1; }
install -d -o root -g root -m 0700 "$BACKUP_DIR"
cp -a -- "$TG_ENV" "$BACKUP_DIR/telegram.env"
[[ ! -f "$WEB_NOTIFY" ]] || cp -a -- "$WEB_NOTIFY" "$BACKUP_DIR/hamkare-web-notify.json"
[[ ! -f "$PANEL_CONFIG" ]] || cp -a -- "$PANEL_CONFIG" "$BACKUP_DIR/panel-config.json"

rollback() {
  local code=$?
  if (( code != 0 )); then
    cp -a -- "$BACKUP_DIR/telegram.env" "$TG_ENV"
    if [[ -f "$BACKUP_DIR/hamkare-web-notify.json" ]]; then
      cp -a -- "$BACKUP_DIR/hamkare-web-notify.json" "$WEB_NOTIFY"
    fi
    if [[ -f "$BACKUP_DIR/panel-config.json" ]]; then
      cp -a -- "$BACKUP_DIR/panel-config.json" "$PANEL_CONFIG"
    fi
    systemctl restart hamkare-telegram.service 2>/dev/null || true
    echo "❌ تغییر ناموفق بود و بکاپ بازگردانده شد: $BACKUP_DIR" >&2
  fi
  return "$code"
}
trap rollback EXIT

python3 - "$TG_ENV" "$WEB_NOTIFY" "$PANEL_CONFIG" "$CHAT_ID" <<'PY'
import json
import os
import stat
import sys
import tempfile

tg_env, web_notify, panel_config, chat_id = sys.argv[1:]


def atomic_write(path, payload, mode, uid, gid):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".hamkare-log-chat-", dir=directory)
    try:
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, uid, gid)
        with os.fdopen(descriptor, "wb") as target:
            target.write(payload)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


info = os.lstat(tg_env)
if not stat.S_ISREG(info.st_mode):
    raise RuntimeError("telegram.env is not a regular file")
with open(tg_env, encoding="utf-8") as source:
    lines = source.read().splitlines()
values = {}
output = []
seen = False
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        values[key] = value
        if key == "LOG_CHAT_ID":
            output.append(f"LOG_CHAT_ID={chat_id}")
            seen = True
            continue
    output.append(line)
if not seen:
    output.append(f"LOG_CHAT_ID={chat_id}")
token = values.get("BOT_TOKEN", "")
if not token:
    raise RuntimeError("BOT_TOKEN is missing")
atomic_write(
    tg_env,
    ("\n".join(output) + "\n").encode(),
    stat.S_IMODE(info.st_mode),
    info.st_uid,
    info.st_gid,
)

notify = {}
notify_info = None
if os.path.exists(web_notify):
    notify_info = os.lstat(web_notify)
    if not stat.S_ISREG(notify_info.st_mode):
        raise RuntimeError("web notify config is not a regular file")
    with open(web_notify, encoding="utf-8") as source:
        notify = json.load(source)
    if not isinstance(notify, dict):
        raise RuntimeError("web notify config is invalid")
notify["telegram"] = {"token": token, "chat_id": chat_id}
atomic_write(
    web_notify,
    (json.dumps(notify, ensure_ascii=False, indent=2) + "\n").encode(),
    stat.S_IMODE(notify_info.st_mode) if notify_info else 0o640,
    notify_info.st_uid if notify_info else 0,
    notify_info.st_gid if notify_info else 33,
)

if os.path.exists(panel_config):
    panel_info = os.lstat(panel_config)
    if not stat.S_ISREG(panel_info.st_mode):
        raise RuntimeError("panel config is not a regular file")
    with open(panel_config, encoding="utf-8") as source:
        panel = json.load(source)
    if not isinstance(panel, dict):
        raise RuntimeError("panel config is invalid")
    panel["chat_ids"] = [chat_id]
    atomic_write(
        panel_config,
        (json.dumps(panel, ensure_ascii=False, indent=2) + "\n").encode(),
        stat.S_IMODE(panel_info.st_mode),
        panel_info.st_uid,
        panel_info.st_gid,
    )
PY

systemctl restart hamkare-telegram.service
sleep 4
systemctl is-active --quiet hamkare-telegram.service || {
  systemctl --no-pager --full status hamkare-telegram.service >&2 || true
  exit 1
}

BOT_TOKEN="$(sed -n 's/^BOT_TOKEN=//p' "$TG_ENV" | tail -n 1)"
python3 - "$BOT_TOKEN" "$CHAT_ID" <<'PY'
import json
import sys
import urllib.request

token, chat_id = sys.argv[1:]
request = urllib.request.Request(
    f"https://api.telegram.org/bot{token}/sendMessage",
    data=json.dumps({
        "chat_id": chat_id,
        "text": "✅ گزارش‌های همکاره به این گروه متصل شد.\nمنابع: سایت، ربات تلگرام و پنل انتشار APK",
        "disable_web_page_preview": True,
    }, ensure_ascii=False).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(request, timeout=20) as response:
    result = json.load(response)
if not result.get("ok"):
    raise RuntimeError("Telegram rejected the verification message")
PY

trap - EXIT
echo "✅ گزارش‌های سایت، ربات تلگرام و پنل APK به $CHAT_ID متصل شد."
echo '✅ سرویس بله و توکن‌ها تغییر نکردند.'
echo "بکاپ: $BACKUP_DIR"
