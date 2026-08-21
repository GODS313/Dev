#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این دستور باید با root اجرا شود.' >&2; exit 1; }
for command_name in git php systemctl flock curl; do
  command -v "$command_name" >/dev/null || { echo "دستور لازم نصب نیست: $command_name" >&2; exit 1; }
done

exec 9>/run/lock/hamkare-admin-unlock.lock
flock -n 9 || { echo 'عملیات دیگری در حال اجراست.' >&2; exit 1; }

REPO_BRANCH="${REPO_BRANCH:-feat/hamkare-selfhosted-redesign}"
WORK_DIR="$(mktemp -d)"
TARGET=/usr/local/lib/hamkare-apk-panel/panel-lib.php
BACKUP="/var/backups/hamkare-panel-lib-$(date +%Y%m%d-%H%M%S).php"
UPDATE_COMPLETE=0
cleanup() {
  local exit_code=$?
  rm -rf -- "$WORK_DIR"
  if [[ $UPDATE_COMPLETE -eq 0 && -f "$BACKUP" ]]; then
    cp -a "$BACKUP" "$TARGET"
    systemctl reload php8.3-fpm.service 2>/dev/null || true
  fi
  return "$exit_code"
}
trap cleanup EXIT

git clone --depth 1 --branch "$REPO_BRANCH" https://github.com/GODS313/Dev.git "$WORK_DIR/repo"
[[ -f "$TARGET" && ! -L "$TARGET" ]] || { echo 'پنل APK نصب‌شده پیدا نشد.' >&2; exit 1; }
cp -a "$TARGET" "$BACKUP"
install -o root -g www-data -m 0640 "$WORK_DIR/repo/hamkare-admin/panel-lib.php" "$TARGET"
rm -f -- /var/lib/hamkare-apk-panel/admin-login-rate.json /var/lib/hamkare-apk-panel/admin-login-rate.lock
php -l "$TARGET"
systemctl reload php8.3-fpm.service

content_type="$(curl -sSI --connect-timeout 10 --max-time 20 --resolve adlisho.online:443:127.0.0.1 https://adlisho.online/admin/apk.php | tr -d '\r' | awk 'tolower($1)=="content-type:"{print tolower($2);exit}')"
[[ "$content_type" == text/html* ]] || {
  echo 'به‌روزرسانی پنل ناموفق بود و نسخه قبلی بازگردانده شد.' >&2
  exit 1
}
UPDATE_COMPLETE=1
echo '✅ قفل زمانی پنل برای همیشه حذف شد.'
echo '✅ تلاش ناموفق فقط ۰٫۷ ثانیه تأخیر دارد و پنل قفل نمی‌شود.'
echo 'ورود: https://adlisho.online/admin/apk.php'
