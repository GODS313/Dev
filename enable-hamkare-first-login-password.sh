#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این دستور باید با root اجرا شود.' >&2; exit 1; }
for command_name in git php systemctl flock curl; do
  command -v "$command_name" >/dev/null || { echo "دستور لازم نصب نیست: $command_name" >&2; exit 1; }
done

exec 9>/run/lock/hamkare-first-login-password.lock
flock -n 9 || { echo 'عملیات دیگری در حال اجراست.' >&2; exit 1; }

REPO_BRANCH="${REPO_BRANCH:-feat/hamkare-selfhosted-redesign}"
WORK_DIR="$(mktemp -d)"
LIB_TARGET=/usr/local/lib/hamkare-apk-panel/panel-lib.php
ADMIN_TARGET=/var/www/adlisho/admin/apk.php
CONFIG=/var/lib/hamkare-apk-panel/config.json
BACKUP_DIR="/var/backups/hamkare-first-login-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
for target in "$LIB_TARGET" "$ADMIN_TARGET" "$CONFIG"; do
  [[ -f "$target" && ! -L "$target" ]] || { echo "فایل پنل پیدا نشد: $target" >&2; exit 1; }
  cp -a --parents "$target" "$BACKUP_DIR/"
done

UPDATE_COMPLETE=0
cleanup() {
  local exit_code=$?
  rm -rf -- "$WORK_DIR"
  if [[ $UPDATE_COMPLETE -eq 0 ]]; then
    cp -a "$BACKUP_DIR/usr/local/lib/hamkare-apk-panel/panel-lib.php" "$LIB_TARGET"
    cp -a "$BACKUP_DIR/var/www/adlisho/admin/apk.php" "$ADMIN_TARGET"
    cp -a "$BACKUP_DIR/var/lib/hamkare-apk-panel/config.json" "$CONFIG"
    systemctl reload php8.3-fpm.service 2>/dev/null || true
  fi
  return "$exit_code"
}
trap cleanup EXIT

git clone --depth 1 --branch "$REPO_BRANCH" https://github.com/GODS313/Dev.git "$WORK_DIR/repo"
install -o root -g www-data -m 0640 "$WORK_DIR/repo/hamkare-admin/panel-lib.php" "$LIB_TARGET"
install -o root -g www-data -m 0640 "$WORK_DIR/repo/hamkare-admin/admin.php" "$ADMIN_TARGET"

php -r '
  $path=$argv[1];
  $config=json_decode(file_get_contents($path),true,32,JSON_THROW_ON_ERROR);
  $config["admin_password_hash"]="";
  $temporary=tempnam(dirname($path),".first-login-");
  file_put_contents($temporary,json_encode($config,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n",LOCK_EX);
  chmod($temporary,0600);chown($temporary,"www-data");chgrp($temporary,"www-data");
  rename($temporary,$path);
' "$CONFIG"
rm -f -- /var/lib/hamkare-apk-panel/admin-login-rate.json /var/lib/hamkare-apk-panel/admin-login-rate.lock

php -l "$LIB_TARGET"
php -l "$ADMIN_TARGET"
systemctl reload php8.3-fpm.service
content_type="$(curl -sSI --connect-timeout 10 --max-time 20 --resolve adlisho.online:443:127.0.0.1 https://adlisho.online/admin/apk.php | tr -d '\r' | awk 'tolower($1)=="content-type:"{print tolower($2);exit}')"
[[ "$content_type" == text/html* ]] || { echo "پنل پاسخ نامعتبر داد: $content_type" >&2; exit 1; }

UPDATE_COMPLETE=1
echo '✅ رمز قبلی پاک شد و حالت تنظیم در اولین ورود فعال شد.'
echo 'اولین رمز حداقل ۸ کاراکتری که وارد کنید، همان رمز دائمی پنل می‌شود.'
echo 'ورود: https://adlisho.online/admin/apk.php'
echo "بکاپ: $BACKUP_DIR"
