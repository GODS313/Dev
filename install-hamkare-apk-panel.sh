#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این نصب‌کننده باید با root اجرا شود.' >&2; exit 1; }
for command_name in flock php python3 realpath stat systemctl curl nginx; do
  command -v "$command_name" >/dev/null || { echo "دستور لازم نصب نیست: $command_name" >&2; exit 1; }
done

exec 9>/run/lock/hamkare-apk-panel-install.lock
flock -n 9 || { echo 'نصب دیگری هم‌زمان در حال اجراست.' >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ADMIN="$SCRIPT_DIR/hamkare-admin/admin.php"
SOURCE_LIB="$SCRIPT_DIR/hamkare-admin/panel-lib.php"
SOURCE_INI="$SCRIPT_DIR/hamkare-admin/99-hamkare-apk-panel.ini"
SOURCE_DOWNLOAD="$SCRIPT_DIR/hamkare-admin/download.php"
SOURCE_DASHBOARD="$SCRIPT_DIR/admin.html"
WEB_ROOT=/var/www/adlisho
ADMIN_DIR=$WEB_ROOT/admin
ADMIN_HANDLER=$ADMIN_DIR/apk.php
ADMIN_DASHBOARD=$ADMIN_DIR/index.html
DOWNLOAD_HANDLER=$WEB_ROOT/download.php
LIVE_APK=$WEB_ROOT/app.apk
STAGE_DIR=$WEB_ROOT/.hamkare-apk-staging
STATE_ROOT=/var/lib/hamkare-apk-panel
CONFIG_FILE=$STATE_ROOT/config.json
BACKUP_DIR=$STATE_ROOT/backups
INSTALL_LIB=/usr/local/lib/hamkare-apk-panel
FPM_INI=/etc/php/8.3/fpm/conf.d/99-hamkare-apk-panel.ini
SNAPSHOT="$(mktemp -d /var/backups/hamkare-apk-panel-XXXXXXXX)"

for source_file in "$SOURCE_ADMIN" "$SOURCE_LIB" "$SOURCE_INI" "$SOURCE_DOWNLOAD" "$SOURCE_DASHBOARD"; do
  [[ -f "$source_file" && ! -L "$source_file" ]] || { echo "فایل نصب معتبر پیدا نشد: $source_file" >&2; exit 1; }
done
[[ -d "$WEB_ROOT" && ! -L "$WEB_ROOT" ]] || { echo 'مسیر اصلی Adlisho پیدا نشد.' >&2; exit 1; }
[[ "$(realpath -e -- "$WEB_ROOT")" == "$WEB_ROOT" ]] || { echo 'مسیر واقعی Adlisho معتبر نیست.' >&2; exit 1; }
WEB_ROOT_UID="$(stat -c %u "$WEB_ROOT")"
WEB_ROOT_GID="$(stat -c %g "$WEB_ROOT")"
WEB_ROOT_MODE="$(stat -c %a "$WEB_ROOT")"
for target in "$ADMIN_DIR" "$ADMIN_HANDLER" "$ADMIN_DASHBOARD" "$DOWNLOAD_HANDLER" "$LIVE_APK" "$STAGE_DIR" "$STATE_ROOT" "$BACKUP_DIR" "$INSTALL_LIB" "$FPM_INI"; do
  [[ ! -L "$target" ]] || { echo "مسیر symbolic link مجاز نیست: $target" >&2; exit 1; }
done

php -m | grep -qi '^curl$' || {
  apt-get update
  apt-get install -y php8.3-curl
}

install -d -o root -g root -m 0700 "$SNAPSHOT"
HAD_ADMIN_HANDLER=0
HAD_ADMIN_DASHBOARD=0
HAD_DOWNLOAD_HANDLER=0
HAD_CONFIG_FILE=0
HAD_FPM_INI=0
HAD_INSTALL_LIB=0
HAD_LIVE_APK=0
[[ ! -f "$ADMIN_HANDLER" ]] || HAD_ADMIN_HANDLER=1
[[ ! -f "$ADMIN_DASHBOARD" ]] || HAD_ADMIN_DASHBOARD=1
[[ ! -f "$DOWNLOAD_HANDLER" ]] || HAD_DOWNLOAD_HANDLER=1
[[ ! -f "$CONFIG_FILE" ]] || HAD_CONFIG_FILE=1
[[ ! -f "$FPM_INI" ]] || HAD_FPM_INI=1
[[ ! -d "$INSTALL_LIB" ]] || HAD_INSTALL_LIB=1
[[ ! -f "$LIVE_APK" ]] || HAD_LIVE_APK=1
for target in "$ADMIN_HANDLER" "$ADMIN_DASHBOARD" "$DOWNLOAD_HANDLER" "$CONFIG_FILE" "$FPM_INI"; do
  [[ ! -f "$target" ]] || cp -a --parents "$target" "$SNAPSHOT/"
done
[[ ! -d "$INSTALL_LIB" ]] || cp -a "$INSTALL_LIB" "$SNAPSHOT/installed-lib"
[[ ! -f "$LIVE_APK" ]] || cp -a "$LIVE_APK" "$SNAPSHOT/app.apk"

INSTALL_COMPLETE=0
rollback_install() {
  local exit_code=$?
  if [[ $INSTALL_COMPLETE -eq 0 ]]; then
    if [[ $HAD_ADMIN_HANDLER -eq 1 ]]; then cp -a "$SNAPSHOT/var/www/adlisho/admin/apk.php" "$ADMIN_HANDLER"; else rm -f -- "$ADMIN_HANDLER"; fi
    if [[ $HAD_ADMIN_DASHBOARD -eq 1 ]]; then cp -a "$SNAPSHOT/var/www/adlisho/admin/index.html" "$ADMIN_DASHBOARD"; else rm -f -- "$ADMIN_DASHBOARD"; fi
    if [[ $HAD_DOWNLOAD_HANDLER -eq 1 ]]; then cp -a "$SNAPSHOT/var/www/adlisho/download.php" "$DOWNLOAD_HANDLER"; else rm -f -- "$DOWNLOAD_HANDLER"; fi
    if [[ $HAD_CONFIG_FILE -eq 1 ]]; then cp -a "$SNAPSHOT/var/lib/hamkare-apk-panel/config.json" "$CONFIG_FILE"; else rm -f -- "$CONFIG_FILE"; fi
    if [[ $HAD_FPM_INI -eq 1 ]]; then cp -a "$SNAPSHOT/etc/php/8.3/fpm/conf.d/99-hamkare-apk-panel.ini" "$FPM_INI"; else rm -f -- "$FPM_INI"; fi
    if [[ $HAD_INSTALL_LIB -eq 1 ]]; then
      rm -rf -- "$INSTALL_LIB"
      install -d -o root -g www-data -m 0750 "$INSTALL_LIB"
      cp -a "$SNAPSHOT/installed-lib/." "$INSTALL_LIB/"
    else
      rm -rf -- "$INSTALL_LIB"
    fi
    if [[ $HAD_LIVE_APK -eq 1 ]]; then cp -a "$SNAPSHOT/app.apk" "$LIVE_APK"; else rm -f -- "$LIVE_APK"; fi
    chown "$WEB_ROOT_UID:$WEB_ROOT_GID" "$WEB_ROOT"
    chmod "$WEB_ROOT_MODE" "$WEB_ROOT"
    systemctl reload php8.3-fpm.service 2>/dev/null || true
    systemctl reload nginx.service 2>/dev/null || true
    echo "نصب ناموفق بود؛ نسخه قبلی از $SNAPSHOT بازگردانده شد." >&2
  fi
  return "$exit_code"
}
trap rollback_install EXIT

chgrp www-data "$WEB_ROOT"
chmod g+rwx "$WEB_ROOT"
install -d -o root -g www-data -m 0750 "$ADMIN_DIR" "$INSTALL_LIB"
install -d -o www-data -g www-data -m 0700 "$STATE_ROOT" "$STAGE_DIR" "$BACKUP_DIR"
install -o root -g www-data -m 0640 "$SOURCE_LIB" "$INSTALL_LIB/panel-lib.php"
install -o root -g www-data -m 0640 "$SOURCE_ADMIN" "$ADMIN_HANDLER"
install -o root -g www-data -m 0644 "$SOURCE_DASHBOARD" "$ADMIN_DASHBOARD"
install -o root -g www-data -m 0644 "$SOURCE_DOWNLOAD" "$DOWNLOAD_HANDLER"
install -o root -g root -m 0644 "$SOURCE_INI" "$FPM_INI"

if [[ ! -f "$CONFIG_FILE" ]]; then
  printf '{}\n' >"$CONFIG_FILE"
fi
chown www-data:www-data "$CONFIG_FILE"
chmod 0600 "$CONFIG_FILE"

for state_file in admin-audit.jsonl admin-login-rate.json admin-login-rate.lock admin-config.lock apk-last-deployment.json; do
  touch "$STATE_ROOT/$state_file"
  chown www-data:www-data "$STATE_ROOT/$state_file"
  chmod 0600 "$STATE_ROOT/$state_file"
done

has_password_hash="$(php -r '$j=json_decode(file_get_contents($argv[1]),true,32,JSON_THROW_ON_ERROR);echo empty($j["admin_password_hash"])?"no":"yes";' "$CONFIG_FILE")"
panel_password="${PANEL_ADMIN_PASSWORD:-}"
if [[ -z "$panel_password" && -t 0 ]]; then
  if [[ "$has_password_hash" == yes ]]; then
    read -rsp 'برای حفظ رمز فعلی Enter بزنید؛ برای تغییر، رمز جدید حداقل ۱۲ نویسه را وارد کنید: ' panel_password; echo
  else
    read -rsp 'یک رمز جدید حداقل ۱۲ نویسه برای آپلود دستی APK وارد کنید: ' panel_password; echo
  fi
fi
if [[ -n "$panel_password" ]]; then
  if [[ -t 0 ]]; then
    read -rsp 'رمز جدید را دوباره وارد کنید: ' panel_password_confirm; echo
    [[ "$panel_password" == "$panel_password_confirm" ]] || { echo 'دو رمز یکسان نیستند.' >&2; exit 1; }
  fi
  [[ ${#panel_password} -ge 12 ]] || { echo 'رمز باید حداقل ۱۲ نویسه باشد.' >&2; exit 1; }
  PANEL_PASSWORD_VALUE="$panel_password" php -r '
    $path=$argv[1];
    $config=json_decode(file_get_contents($path),true,32,JSON_THROW_ON_ERROR);
    $config["admin_password_hash"]=password_hash((string)getenv("PANEL_PASSWORD_VALUE"),PASSWORD_DEFAULT);
    $config["apk_name"]="hamkare.apk";
    foreach(["chat_ids","admin_chat_ids","apk_channel_ids"] as $key){$config[$key]=[];}
    $tmp=tempnam(dirname($path),".config-");
    file_put_contents($tmp,json_encode($config,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n",LOCK_EX);
    chmod($tmp,0600);chown($tmp,"www-data");chgrp($tmp,"www-data");rename($tmp,$path);
  ' "$CONFIG_FILE"
elif [[ "$has_password_hash" != yes ]]; then
  echo 'رمز پنل تنظیم نشده و ورودی تعاملی در دسترس نیست.' >&2
  exit 1
fi
unset panel_password panel_password_confirm PANEL_ADMIN_PASSWORD PANEL_PASSWORD_VALUE

runuser -u www-data -- test -r "$CONFIG_FILE" || { echo 'PHP امکان خواندن config را ندارد.' >&2; exit 1; }
runuser -u www-data -- test -w "$CONFIG_FILE" || { echo 'PHP امکان تغییر config را ندارد.' >&2; exit 1; }
runuser -u www-data -- test -w "$STATE_ROOT" || { echo 'PHP امکان نوشتن state را ندارد.' >&2; exit 1; }
runuser -u www-data -- test -w "$WEB_ROOT" || { echo 'PHP امکان انتشار APK در Adlisho را ندارد.' >&2; exit 1; }
[[ "$(stat -c %d "$STAGE_DIR")" == "$(stat -c %d "$WEB_ROOT")" ]] || { echo 'staging و APK روی یک filesystem نیستند.' >&2; exit 1; }

php -l "$ADMIN_HANDLER"
php -l "$DOWNLOAD_HANDLER"
php -l "$INSTALL_LIB/panel-lib.php"
nginx -t
systemctl reload php8.3-fpm.service
systemctl reload nginx.service

status_code="$(curl -sS --connect-timeout 10 --max-time 30 --resolve adlisho.online:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://adlisho.online/admin/apk.php)"
[[ "$status_code" == 200 ]] || { echo "پنل APK پاسخ HTTP $status_code داد." >&2; exit 1; }

INSTALL_COMPLETE=1
echo '✅ پنل APK همکاره فقط روی Adlisho نصب شد.'
echo '✅ آپلود بدون بازکردن، تغییر یا بررسی امضا انجام می‌شود.'
echo '✅ مسیر فایل: /var/www/adlisho/app.apk'
echo '✅ لینک سایت و دکمه بله: https://adlisho.online/download'
echo 'پنل: https://adlisho.online/admin/apk.php'
echo "بکاپ: $SNAPSHOT"
