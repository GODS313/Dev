#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

[[ $EUID -eq 0 ]] || { echo 'Run this deployment as root.' >&2; exit 1; }
command -v flock >/dev/null || { echo 'flock is required.' >&2; exit 1; }
exec 9>/run/lock/hamkare-web-deploy.lock
flock -n 9 || { echo 'Another Hamkare deployment is already running.' >&2; exit 1; }

WEB_ROOT="${WEB_ROOT:-/var/www/adlisho}"
REPO_URL="https://github.com/GODS313/Dev.git"
REPO_BRANCH="main"
TMP_DIR="$(mktemp -d)"
BACKUP_DIR="/var/backups/adlisho-$(date +%Y%m%d-%H%M%S)"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

command -v realpath >/dev/null || { echo 'realpath is required.' >&2; exit 1; }
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
elif [[ -e "$WEB_ROOT/download.php" || -L "$WEB_ROOT/download.php" ]]; then
  # The complete web-root backup above keeps this recoverable; never preserve stale PHP.
  rm -- "$WEB_ROOT/download.php"
fi
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/result.html" "$WEB_ROOT/result.html"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/config.json" "$WEB_ROOT/config.json"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/favicon.svg" "$WEB_ROOT/favicon.svg"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/qr-download.png" "$WEB_ROOT/qr-download.png"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/manifest.json" "$WEB_ROOT/manifest.json"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/privacy.html" "$WEB_ROOT/privacy.html"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/terms.html" "$WEB_ROOT/terms.html"
install -o www-data -g www-data -m 0644 "$TMP_DIR/repo/contact.html" "$WEB_ROOT/contact.html"

if [[ -f "$WEB_ROOT/download.php" ]]; then
  php -l "$WEB_ROOT/download.php"
fi
nginx -t
systemctl reload nginx

echo "Deployment completed. Backup: $BACKUP_DIR"
