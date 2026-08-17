#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این نصب‌کننده باید با sudo/root اجرا شود.' >&2; exit 1; }

APP_DIR="${HAMKARE_APP_DIR:-/opt/hamkare-bots}"
TG_ENV="$APP_DIR/telegram.env"
BALE_ENV="$APP_DIR/bale.env"
SYNC_URL="${HAMKARE_SYNC_URL:-https://adlisho.online/api/admin/sync}"
PUBLIC_DOWNLOAD_URL='https://adlisho.online/download.php'
SYNC_PROGRAM=/usr/local/sbin/hamkare-admin-sync
SYNC_ENV=/etc/hamkare-admin-sync.env
STATE_DIR=/var/lib/hamkare-admin-sync
BACKUP_DIR="/var/backups/hamkare-admin-sync-$(date +%Y%m%d-%H%M%S)"

for required in python3 systemctl; do
  command -v "$required" >/dev/null || { echo "دستور لازم موجود نیست: $required" >&2; exit 1; }
done
for required in "$TG_ENV" "$BALE_ENV"; do
  [[ -f "$required" && ! -L "$required" ]] || { echo "فایل امن پیدا نشد: $required" >&2; exit 1; }
done
[[ "$SYNC_URL" =~ ^https://[^[:space:]]+$ ]] || { echo 'HAMKARE_SYNC_URL باید HTTPS باشد.' >&2; exit 1; }

SYNC_KEY="${VPS_SYNC_KEY:-}"
if [[ -z "$SYNC_KEY" ]]; then
  read -rsp 'VPS_SYNC_KEY تنظیم‌شده در Cloudflare را وارد کنید: ' SYNC_KEY
  echo
fi
[[ "$SYNC_KEY" =~ ^[A-Za-z0-9_-]{32,128}$ ]] || {
  echo 'VPS_SYNC_KEY باید ۳۲ تا ۱۲۸ نویسه امن داشته باشد.' >&2
  exit 1
}

install -d -m 0700 "$BACKUP_DIR" "$STATE_DIR"
cp -a "$TG_ENV" "$BALE_ENV" "$BACKUP_DIR/"
for legacy in \
  /var/lib/hamkare-admin/config.json \
  /usr/local/sbin/hamkare-admin-apply \
  /etc/sudoers.d/hamkare-admin \
  /var/www/adlisho/admin.php
do
  [[ -e "$legacy" || -L "$legacy" ]] && cp -a "$legacy" "$BACKUP_DIR/"
done

cat > "$SYNC_PROGRAM" <<'PY'
#!/usr/bin/python3
import fcntl
import json
import os
import re
import stat
import subprocess
import tempfile
import urllib.request

TG_ENV = os.environ.get("HAMKARE_TELEGRAM_ENV", "/opt/hamkare-bots/telegram.env")
BALE_ENV = os.environ.get("HAMKARE_BALE_ENV", "/opt/hamkare-bots/bale.env")
SYNC_URL = os.environ.get("HAMKARE_SYNC_URL", "https://adlisho.online/api/admin/sync")
SYNC_KEY = os.environ["VPS_SYNC_KEY"]
PUBLIC_DOWNLOAD_URL = "https://adlisho.online/download.php"
STATE_FILE = "/var/lib/hamkare-admin-sync/state.json"
LOCK_FILE = "/run/lock/hamkare-admin-sync.lock"
TOKEN_RE = re.compile(r"^[A-Za-z0-9_:.-]{20,256}$")
CHAT_RE = re.compile(r"^-?[0-9]{4,20}$")


def fetch_config():
    request = urllib.request.Request(
        SYNC_URL,
        headers={"X-Sync-Key": SYNC_KEY, "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f"sync returned HTTP {response.status}")
        raw = response.read(65537)
    if len(raw) > 65536:
        raise RuntimeError("sync response is too large")
    data = json.loads(raw)
    if data.get("canonical_download_url") != PUBLIC_DOWNLOAD_URL:
        raise RuntimeError("canonical download URL mismatch")
    source = str(data.get("download_source", ""))
    if not source.startswith("https://"):
        raise RuntimeError("invalid download source")
    return data


def platform_values(data, name):
    value = data.get(name)
    if value is None:
        return None
    if not isinstance(value, dict):
        raise RuntimeError(f"invalid {name} settings")
    token = str(value.get("token", ""))
    chat_id = str(value.get("chat_id", ""))
    if not TOKEN_RE.fullmatch(token) or not CHAT_RE.fullmatch(chat_id):
        raise RuntimeError(f"invalid {name} credentials")
    return {
        "BOT_TOKEN": token,
        "LOG_CHAT_ID": chat_id,
        "DOWNLOAD_URL": PUBLIC_DOWNLOAD_URL,
    }


def prepare_env(path, values):
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode):
        raise RuntimeError(f"unsafe env path: {path}")
    with open(path, "rb") as handle:
        original = handle.read()
    text = original.decode("utf-8")
    lines = text.splitlines()
    current = {}
    for line in lines:
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            current[key] = value
    if all(current.get(key) == value for key, value in values.items()):
        return None

    output = []
    seen = set()
    for line in lines:
        key = line.split("=", 1)[0] if "=" in line else ""
        if key in values:
            output.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            output.append(line)
    for key, value in values.items():
        if key not in seen:
            output.append(f"{key}={value}")
    payload = ("\n".join(output) + "\n").encode("utf-8")
    fd, temporary = tempfile.mkstemp(prefix=".hamkare-env-", dir=os.path.dirname(path))
    try:
        os.fchmod(fd, stat.S_IMODE(info.st_mode))
        os.fchown(fd, info.st_uid, info.st_gid)
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise
    return {"path": path, "temporary": temporary, "original": original, "stat": info}


def atomic_restore(item):
    fd, temporary = tempfile.mkstemp(prefix=".hamkare-rollback-", dir=os.path.dirname(item["path"]))
    try:
        os.fchmod(fd, stat.S_IMODE(item["stat"].st_mode))
        os.fchown(fd, item["stat"].st_uid, item["stat"].st_gid)
        with os.fdopen(fd, "wb") as handle:
            handle.write(item["original"])
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, item["path"])
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise


def write_state(data):
    os.makedirs(os.path.dirname(STATE_FILE), mode=0o700, exist_ok=True)
    payload = json.dumps(
        {"revision": data.get("revision", ""), "download_source": data["download_source"]},
        ensure_ascii=False,
        indent=2,
    ).encode("utf-8") + b"\n"
    fd, temporary = tempfile.mkstemp(prefix=".state-", dir=os.path.dirname(STATE_FILE))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, STATE_FILE)
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise


def main():
    os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)
    with open(LOCK_FILE, "a+", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = fetch_config()
        pending = []
        for name, path in (("telegram", TG_ENV), ("bale", BALE_ENV)):
            values = platform_values(data, name)
            if values is not None:
                prepared = prepare_env(path, values)
                if prepared is not None:
                    prepared["service"] = f"hamkare-{name}.service"
                    pending.append(prepared)

        replaced = []
        try:
            for item in pending:
                os.replace(item["temporary"], item["path"])
                replaced.append(item)
            for item in pending:
                subprocess.run(["systemctl", "restart", item["service"]], check=True)
            write_state(data)
        except BaseException:
            for item in reversed(replaced):
                atomic_restore(item)
            for item in replaced:
                subprocess.run(["systemctl", "restart", item["service"]], check=False)
            raise
        finally:
            for item in pending:
                temporary = item["temporary"]
                if os.path.exists(temporary):
                    os.unlink(temporary)
        changed = ",".join(item["service"] for item in pending) or "none"
        print(f"hamkare sync ok; restarted={changed}")


if __name__ == "__main__":
    main()
PY
chmod 0750 "$SYNC_PROGRAM"
chown root:root "$SYNC_PROGRAM"
python3 -m py_compile "$SYNC_PROGRAM"

cat > "$SYNC_ENV" <<EOF
VPS_SYNC_KEY=$SYNC_KEY
HAMKARE_SYNC_URL=$SYNC_URL
HAMKARE_TELEGRAM_ENV=$TG_ENV
HAMKARE_BALE_ENV=$BALE_ENV
EOF
chmod 0600 "$SYNC_ENV"
chown root:root "$SYNC_ENV"

# Fail safely before retiring the old writer. This call also proves that the
# deployed Function, D1 binding, encryption key and VPS_SYNC_KEY agree.
VPS_SYNC_KEY="$SYNC_KEY" \
HAMKARE_SYNC_URL="$SYNC_URL" \
HAMKARE_TELEGRAM_ENV="$TG_ENV" \
HAMKARE_BALE_ENV="$BALE_ENV" \
  "$SYNC_PROGRAM"
unset SYNC_KEY

cat > /etc/systemd/system/hamkare-admin-sync.service <<EOF
[Unit]
Description=Synchronize Hamkare D1 settings to VPS bot services
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=$SYNC_ENV
ExecStart=$SYNC_PROGRAM
User=root
Group=root
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR $STATE_DIR /run/lock
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
EOF

cat > /etc/systemd/system/hamkare-admin-sync.timer <<'EOF'
[Unit]
Description=Poll canonical Hamkare settings

[Timer]
OnBootSec=20s
OnUnitActiveSec=30s
RandomizedDelaySec=5s
Persistent=true
Unit=hamkare-admin-sync.service

[Install]
WantedBy=timers.target
EOF

# Retire the old local writer only after it has been backed up.
rm -f /etc/sudoers.d/hamkare-admin /usr/local/sbin/hamkare-admin-apply
if [[ -f /var/lib/hamkare-admin/config.json && ! -L /var/lib/hamkare-admin/config.json ]]; then
  mv /var/lib/hamkare-admin/config.json "$BACKUP_DIR/legacy-local-config.json"
fi

# Any old VPS bookmark now points to the one canonical Cloudflare panel.
if [[ -d /var/www/adlisho ]]; then
  cat > /var/www/adlisho/admin.php <<'PHP'
<?php
declare(strict_types=1);
header('Cache-Control: no-store');
header('Location: https://adlisho.online/admin', true, 308);
exit;
PHP
  chown root:www-data /var/www/adlisho/admin.php
  chmod 0640 /var/www/adlisho/admin.php
  php -l /var/www/adlisho/admin.php
fi

systemctl daemon-reload
systemctl enable --now hamkare-admin-sync.timer
systemctl start hamkare-admin-sync.service
systemctl is-active --quiet hamkare-admin-sync.timer

echo '✅ source of truth: Cloudflare D1'
echo '✅ پنل واحد: https://adlisho.online/admin'
echo '✅ دانلود ثابت: https://adlisho.online/download.php'
echo "✅ بکاپ مسیر قدیمی: $BACKUP_DIR"
echo 'وضعیت: systemctl status hamkare-admin-sync.timer --no-pager'
