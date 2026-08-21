#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

[[ $EUID -eq 0 ]] || { echo 'Run this deployment as root.' >&2; exit 1; }
command -v flock >/dev/null || { echo 'flock is required.' >&2; exit 1; }
exec 9>/run/lock/hamkare-web-deploy.lock
flock -n 9 || { echo 'Another Hamkare deployment is already running.' >&2; exit 1; }

WEB_ROOT="${WEB_ROOT:-/var/www/adlisho}"
REPO_URL="https://github.com/GODS313/Dev.git"
REPO_BRANCH="${REPO_BRANCH:-main}"
TMP_DIR="$(mktemp -d)"
BACKUP_DIR="/var/backups/adlisho-$(date +%Y%m%d-%H%M%S)"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

command -v realpath >/dev/null || { echo 'realpath is required.' >&2; exit 1; }
command -v php >/dev/null || { echo 'php is required.' >&2; exit 1; }
php -r "exit(extension_loaded('pdo_sqlite') && extension_loaded('mbstring') ? 0 : 1);" || { echo 'PHP extensions pdo_sqlite and mbstring are required.' >&2; exit 1; }
[[ -d "$WEB_ROOT" ]] || { echo "Web root not found: $WEB_ROOT" >&2; exit 1; }
WEB_ROOT="$(realpath -e -- "$WEB_ROOT")"

if [[ "$WEB_ROOT" != /var/www/* || "$WEB_ROOT" == /var/www ]]; then
  echo "Unsafe web root: $WEB_ROOT" >&2
  exit 1
fi

git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$TMP_DIR/repo"
mkdir -p "$BACKUP_DIR"
cp -a "$WEB_ROOT/." "$BACKUP_DIR/"

install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/index.html" "$WEB_ROOT/index.html"
if [[ -f "$TMP_DIR/repo/download.php" ]]; then
  install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/download.php" "$WEB_ROOT/download.php"
  install -d -o www-data -g www-data -m 0755 "$WEB_ROOT/download"
  install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/download.php" "$WEB_ROOT/download/index.php"
elif [[ -e "$WEB_ROOT/download.php" || -L "$WEB_ROOT/download.php" ]]; then
  # The complete web-root backup above keeps this recoverable; never preserve stale PHP.
  rm -- "$WEB_ROOT/download.php"
fi
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/result.html" "$WEB_ROOT/result.html"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/config.json" "$WEB_ROOT/config.json"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/favicon.svg" "$WEB_ROOT/favicon.svg"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/logo.svg" "$WEB_ROOT/logo.svg"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/qr-download.png" "$WEB_ROOT/qr-download.png"
install -d -o www-data -g www-data -m 0755 "$WEB_ROOT/assets"
for image in team.jpg office.jpg industry.jpg; do
  install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/assets/$image" "$WEB_ROOT/assets/$image"
done
for asset in hamkare-ui.css hamkare-selfhosted.css hamkare-ui.js hamkare-sites.css hamkare-sites.js hamkare-hero.webp hamkare-work.webp hamkare-industry.webp; do
  install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/assets/$asset" "$WEB_ROOT/assets/$asset"
done
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/manifest.json" "$WEB_ROOT/manifest.json"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/privacy.html" "$WEB_ROOT/privacy.html"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/terms.html" "$WEB_ROOT/terms.html"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/contact.html" "$WEB_ROOT/contact.html"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/register.php" "$WEB_ROOT/register.php"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/result.php" "$WEB_ROOT/result.php"
for compatibility_file in \
  auth/login/index.html \
  est/index.html \
  est/auth/login/index.html \
  est/api/health/index.html \
  est/api/version/index.html
do
  install -d -o www-data -g www-data -m 0755 "$WEB_ROOT/$(dirname -- "$compatibility_file")"
  install -o www-data -g www-data -m 0644 \
    "$TMP_DIR/repo/compat/$compatibility_file" "$WEB_ROOT/$compatibility_file"
done
install -d -o www-data -g www-data -m 0750 /var/lib/hamkare-web

python3 - /opt/hamkare-bots/telegram.env /opt/hamkare-bots/bale.env /etc/hamkare-web-notify.json <<'PY'
import json, os, stat, sys, tempfile
output = {}
for platform, path in zip(('telegram', 'bale'), sys.argv[1:3]):
    if not os.path.isfile(path) or os.path.islink(path):
        continue
    values = {}
    with open(path, encoding='utf-8') as source:
        for line in source:
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.rstrip('\n').split('=', 1)
                values[key] = value
    if values.get('BOT_TOKEN') and values.get('LOG_CHAT_ID'):
        output[platform] = {'token': values['BOT_TOKEN'], 'chat_id': values['LOG_CHAT_ID']}
target = sys.argv[3]
fd, temporary = tempfile.mkstemp(prefix='.hamkare-web-notify-', dir=os.path.dirname(target))
try:
    os.fchmod(fd, 0o640)
    with os.fdopen(fd, 'w', encoding='utf-8') as destination:
        json.dump(output, destination, ensure_ascii=False)
        destination.flush(); os.fsync(destination.fileno())
    os.chown(temporary, 0, 33)
    os.replace(temporary, target)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
PY

if [[ -f "$WEB_ROOT/download.php" ]]; then
  php -l "$WEB_ROOT/download.php"
fi
php -l "$WEB_ROOT/register.php"
php -l "$WEB_ROOT/result.php"
nginx -t
systemctl reload nginx

curl -fsS --connect-timeout 10 --max-time 30 \
  --resolve adlisho.online:443:127.0.0.1 \
  -o /dev/null https://adlisho.online/ || {
    echo 'Local HTTPS verification failed after deployment.' >&2
    exit 1
  }

echo "Deployment completed. Backup: $BACKUP_DIR"
