#!/usr/bin/env bash
set -Eeuo pipefail

WEB_ROOT="${WEB_ROOT:-/var/www/adlisho}"
REPO_URL="https://github.com/GODS313/Dev.git"
TMP_DIR="$(mktemp -d)"
BACKUP_DIR="/var/backups/adlisho-$(date +%Y%m%d-%H%M%S)"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

if [[ ! -d "$WEB_ROOT" ]]; then
  echo "Web root not found: $WEB_ROOT" >&2
  exit 1
fi

git clone --depth 1 --branch main "$REPO_URL" "$TMP_DIR/repo"
mkdir -p "$BACKUP_DIR"
cp -a "$WEB_ROOT/." "$BACKUP_DIR/"

install -m 0644 "$TMP_DIR/repo/index.html" "$WEB_ROOT/index.html"
install -m 0644 "$TMP_DIR/repo/download.php" "$WEB_ROOT/download.php"
install -m 0644 "$TMP_DIR/repo/result.html" "$WEB_ROOT/result.html"
install -m 0644 "$TMP_DIR/repo/config.json" "$WEB_ROOT/config.json"
install -m 0644 "$TMP_DIR/repo/favicon.svg" "$WEB_ROOT/favicon.svg"
install -m 0644 "$TMP_DIR/repo/manifest.json" "$WEB_ROOT/manifest.json"
install -m 0644 "$TMP_DIR/repo/privacy.html" "$WEB_ROOT/privacy.html"
install -m 0644 "$TMP_DIR/repo/terms.html" "$WEB_ROOT/terms.html"
install -m 0644 "$TMP_DIR/repo/contact.html" "$WEB_ROOT/contact.html"

chown -R www-data:www-data "$WEB_ROOT"
find "$WEB_ROOT" -type d -exec chmod 0755 {} +
find "$WEB_ROOT" -type f -exec chmod 0644 {} +

php -l "$WEB_ROOT/download.php"
nginx -t
systemctl reload nginx

echo "Deployment completed. Backup: $BACKUP_DIR"
