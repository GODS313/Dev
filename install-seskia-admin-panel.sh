#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این نصب‌کننده باید با root اجرا شود.' >&2; exit 1; }
command -v flock >/dev/null || { echo 'flock نصب نیست.' >&2; exit 1; }
command -v systemctl >/dev/null || { echo 'systemd در دسترس نیست.' >&2; exit 1; }
command -v realpath >/dev/null || { echo 'realpath در دسترس نیست.' >&2; exit 1; }
exec 9>/run/lock/seskia-admin-panel-install.lock
flock -n 9 || { echo 'نصب دیگری هم‌زمان در حال اجراست.' >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ADMIN="$SCRIPT_DIR/seskia-admin/admin.php"
SOURCE_LIB="$SCRIPT_DIR/seskia-admin/panel-lib.php"
SOURCE_INI="$SCRIPT_DIR/seskia-admin/99-seskia-admin.ini"
SOURCE_DOWNLOAD="$SCRIPT_DIR/seskia-admin/download.php"
WEB_ROOT=/var/www/seskia
STATE_ROOT=/var/lib/seskia
CONFIG_FILE=$STATE_ROOT/config.json
DOWNLOAD_HANDLER=$WEB_ROOT/download.php
STAGE_DIR=/var/www/.seskia-apk-stage
BACKUP_DIR=$STATE_ROOT/backups
INSTALL_LIB=/usr/local/lib/seskia-admin
FPM_INI=/etc/php/8.3/fpm/conf.d/99-seskia-admin.ini
SNAPSHOT_PREFIX=/var/backups/seskia-admin-panel-$(date +%Y%m%d-%H%M%S)

for source_file in "$SOURCE_ADMIN" "$SOURCE_LIB" "$SOURCE_INI" "$SOURCE_DOWNLOAD"; do
  [[ -f "$source_file" && ! -L "$source_file" ]] || { echo "فایل نصب معتبر پیدا نشد: $source_file" >&2; exit 1; }
done
[[ -d "$WEB_ROOT" && -d "$STATE_ROOT" ]] || { echo 'ساختار فعلی Seskia پیدا نشد.' >&2; exit 1; }
[[ ! -L "$WEB_ROOT" && ! -L "$STATE_ROOT" ]] || { echo 'مسیرهای اصلی Seskia نباید symbolic link باشند.' >&2; exit 1; }
[[ "$(realpath -e -- "$WEB_ROOT")" == "$WEB_ROOT" && "$(realpath -e -- "$STATE_ROOT")" == "$STATE_ROOT" ]] || { echo 'مسیر واقعی Seskia با مسیر مورد انتظار یکسان نیست.' >&2; exit 1; }
[[ -f "$CONFIG_FILE" && ! -L "$CONFIG_FILE" ]] || { echo "تنظیمات معتبر پیدا نشد: $CONFIG_FILE" >&2; exit 1; }
[[ -f "$WEB_ROOT/telegram.php" && ! -L "$WEB_ROOT/telegram.php" ]] || { echo 'webhook معتبر تلگرام پیدا نشد؛ نصب متوقف شد.' >&2; exit 1; }
[[ ! -e "$WEB_ROOT/admin.php" || ! -L "$WEB_ROOT/admin.php" ]] || { echo 'admin.php فعلی symbolic link است؛ نصب متوقف شد.' >&2; exit 1; }
[[ ! -e "$DOWNLOAD_HANDLER" || ! -L "$DOWNLOAD_HANDLER" ]] || { echo 'download.php فعلی symbolic link است؛ نصب متوقف شد.' >&2; exit 1; }
[[ ! -e "$INSTALL_LIB" || ! -L "$INSTALL_LIB" ]] || { echo 'مسیر کتابخانه پنل symbolic link است؛ نصب متوقف شد.' >&2; exit 1; }
[[ ! -e "$FPM_INI" || ! -L "$FPM_INI" ]] || { echo 'فایل تنظیمات PHP symbolic link است؛ نصب متوقف شد.' >&2; exit 1; }
[[ ! -e "$STAGE_DIR" || ! -L "$STAGE_DIR" ]] || { echo 'مسیر staging symbolic link است؛ نصب متوقف شد.' >&2; exit 1; }
[[ ! -e "$BACKUP_DIR" || ! -L "$BACKUP_DIR" ]] || { echo 'مسیر بکاپ symbolic link است؛ نصب متوقف شد.' >&2; exit 1; }

missing_packages=()
command -v php >/dev/null || missing_packages+=(php8.3-cli)
command -v python3 >/dev/null || missing_packages+=(python3)
command -v curl >/dev/null || missing_packages+=(curl)
php -m 2>/dev/null | grep -qi '^curl$' || missing_packages+=(php8.3-curl)
if ((${#missing_packages[@]})); then
  apt-get update
  apt-get install -y "${missing_packages[@]}"
fi

php -r '$p=$argv[1];$j=json_decode(file_get_contents($p),true,32,JSON_THROW_ON_ERROR);if(!is_array($j)){exit(2);}' "$CONFIG_FILE"
HAD_ADMIN=0; [[ ! -f "$WEB_ROOT/admin.php" ]] || HAD_ADMIN=1
HAD_DOWNLOAD=0; [[ ! -f "$DOWNLOAD_HANDLER" ]] || HAD_DOWNLOAD=1
HAD_LIB=0; [[ ! -d "$INSTALL_LIB" ]] || HAD_LIB=1
HAD_INI=0; [[ ! -f "$FPM_INI" ]] || HAD_INI=1
SNAPSHOT="$(mktemp -d "${SNAPSHOT_PREFIX}-XXXXXX")"
cp -a "$CONFIG_FILE" "$SNAPSHOT/config.json"
[[ ! -f "$WEB_ROOT/admin.php" ]] || cp -a "$WEB_ROOT/admin.php" "$SNAPSHOT/admin.php"
[[ ! -f "$DOWNLOAD_HANDLER" ]] || cp -a "$DOWNLOAD_HANDLER" "$SNAPSHOT/download.php"
[[ ! -d "$INSTALL_LIB" ]] || cp -a "$INSTALL_LIB" "$SNAPSHOT/installed-lib"
[[ ! -f "$FPM_INI" ]] || cp -a "$FPM_INI" "$SNAPSHOT/99-seskia-admin.ini"

INSTALL_COMPLETE=0
rollback_install() {
  local exit_code=$?
  if [[ $INSTALL_COMPLETE -eq 0 ]]; then
    cp -a "$SNAPSHOT/config.json" "$CONFIG_FILE" 2>/dev/null || true
    if [[ $HAD_ADMIN -eq 1 ]]; then cp -a "$SNAPSHOT/admin.php" "$WEB_ROOT/admin.php" 2>/dev/null || true; else rm -f -- "$WEB_ROOT/admin.php"; fi
    if [[ $HAD_DOWNLOAD -eq 1 ]]; then cp -a "$SNAPSHOT/download.php" "$DOWNLOAD_HANDLER" 2>/dev/null || true; else rm -f -- "$DOWNLOAD_HANDLER"; fi
    if [[ $HAD_LIB -eq 1 ]]; then
      rm -rf -- "$INSTALL_LIB"
      cp -a "$SNAPSHOT/installed-lib" "$INSTALL_LIB" 2>/dev/null || true
    else
      rm -rf -- "$INSTALL_LIB"
    fi
    if [[ $HAD_INI -eq 1 ]]; then cp -a "$SNAPSHOT/99-seskia-admin.ini" "$FPM_INI" 2>/dev/null || true; else rm -f -- "$FPM_INI"; fi
    systemctl reload php8.3-fpm.service 2>/dev/null || true
    echo "نصب ناموفق بود و فایل‌های قبلی بازگردانده شدند. بکاپ: $SNAPSHOT" >&2
  fi
  return "$exit_code"
}
trap rollback_install EXIT

install -d -o root -g www-data -m 0750 "$INSTALL_LIB"
install -o root -g www-data -m 0640 "$SOURCE_LIB" "$INSTALL_LIB/panel-lib.php"
install -o root -g www-data -m 0640 "$SOURCE_ADMIN" "$WEB_ROOT/admin.php"
install -o root -g www-data -m 0640 "$SOURCE_DOWNLOAD" "$DOWNLOAD_HANDLER"
install -o root -g root -m 0644 "$SOURCE_INI" "$FPM_INI"
python3 - "$CONFIG_FILE" "$STAGE_DIR" "$BACKUP_DIR" "$STATE_ROOT" <<'PY'
import os
import pwd
import stat
import sys

config_path, stage_dir, backup_dir, state_root = sys.argv[1:]
account = pwd.getpwnam("www-data")

for directory in (stage_dir, backup_dir):
    try:
        os.mkdir(directory, 0o700)
    except FileExistsError:
        pass
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
            raise RuntimeError(f"not a directory: {directory}")
        os.fchown(descriptor, account.pw_uid, account.pw_gid)
        os.fchmod(descriptor, 0o700)
    finally:
        os.close(descriptor)

state_files = [
    config_path,
    *(
        os.path.join(state_root, name)
        for name in (
            "admin-audit.jsonl",
            "admin-login-rate.json",
            "admin-login-rate.lock",
            "admin-config.lock",
            "apk-last-deployment.json",
        )
    ),
]
for index, path in enumerate(state_files):
    flags = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC
    if index:
        flags |= os.O_CREAT
    descriptor = os.open(path, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise RuntimeError(f"not a regular state file: {path}")
        os.fchown(descriptor, account.pw_uid, account.pw_gid)
        os.fchmod(descriptor, 0o600)
    finally:
        os.close(descriptor)
PY
exec 8>"$STATE_ROOT/admin-config.lock"
flock 8

has_password_hash="$(php -r '$j=json_decode(file_get_contents($argv[1]),true,32,JSON_THROW_ON_ERROR);echo empty($j["admin_password_hash"])?"no":"yes";' "$CONFIG_FILE")"
panel_password="${PANEL_ADMIN_PASSWORD:-}"
if [[ -z "$panel_password" && -t 0 ]]; then
  if [[ "$has_password_hash" == yes ]]; then
    read -rsp 'برای حفظ رمز فعلی Enter بزنید؛ برای تغییر، رمز جدید حداقل ۱۲ نویسه را وارد کنید: ' panel_password; echo
  else
    read -rsp 'یک رمز جدید حداقل ۱۲ نویسه برای پنل وارد کنید: ' panel_password; echo
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
    if(empty($config["webhook_secret"])){$config["webhook_secret"]=bin2hex(random_bytes(24));}
    foreach(["chat_ids","admin_chat_ids","apk_channel_ids"] as $key){if(!isset($config[$key])||!is_array($config[$key])){$config[$key]=[];}}
    $tmp=tempnam(dirname($path),".config-");
    file_put_contents($tmp,json_encode($config,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n",LOCK_EX);
    chmod($tmp,0600);
    rename($tmp,$path);
  ' "$CONFIG_FILE"
  unset panel_password panel_password_confirm PANEL_PASSWORD_VALUE
elif [[ "$has_password_hash" == yes ]]; then
  php -r '
    $path=$argv[1];
    $config=json_decode(file_get_contents($path),true,32,JSON_THROW_ON_ERROR);
    $changed=false;
    if(($config["apk_name"]??"")!=="hamkare.apk"){$config["apk_name"]="hamkare.apk";$changed=true;}
    if(empty($config["webhook_secret"])){$config["webhook_secret"]=bin2hex(random_bytes(24));$changed=true;}
    foreach(["chat_ids","admin_chat_ids","apk_channel_ids"] as $key){if(!isset($config[$key])||!is_array($config[$key])){$config[$key]=[];$changed=true;}}
    if($changed){$tmp=tempnam(dirname($path),".config-");file_put_contents($tmp,json_encode($config,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n",LOCK_EX);chmod($tmp,0600);rename($tmp,$path);}
  ' "$CONFIG_FILE"
else
  echo 'رمز پنل تنظیم نشده و ورودی تعاملی در دسترس نیست.' >&2
  exit 1
fi
unset panel_password panel_password_confirm PANEL_ADMIN_PASSWORD

runuser -u www-data -- test -r "$CONFIG_FILE" || { echo 'PHP امکان خواندن config را ندارد.' >&2; exit 1; }
runuser -u www-data -- test -w "$CONFIG_FILE" || { echo 'PHP امکان تغییر config را ندارد.' >&2; exit 1; }
runuser -u www-data -- test -w "$STATE_ROOT" || { echo 'PHP امکان جایگزینی اتمیک config در state را ندارد.' >&2; exit 1; }
runuser -u www-data -- test -w "$WEB_ROOT" || { echo 'PHP امکان انتشار اتمیک APK در web root را ندارد.' >&2; exit 1; }
[[ "$(stat -c %d "$STAGE_DIR")" == "$(stat -c %d "$WEB_ROOT")" ]] || { echo 'staging و APK روی یک filesystem نیستند.' >&2; exit 1; }

php -l "$WEB_ROOT/admin.php"
php -l "$DOWNLOAD_HANDLER"
php -l "$INSTALL_LIB/panel-lib.php"
php -m | grep -qi '^curl$'
nginx -t
systemctl reload php8.3-fpm.service
systemctl reload nginx.service

status_code="$(curl -sS --connect-timeout 10 --max-time 30 --resolve seskia.online:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://seskia.online/admin.php)"
[[ "$status_code" == 200 ]] || { echo "پنل HTTP $status_code برگرداند؛ بکاپ: $SNAPSHOT" >&2; exit 1; }
webhook_status="$(curl -sS --connect-timeout 10 --max-time 30 --resolve seskia.online:443:127.0.0.1 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST --data '{}' 'https://seskia.online/telegram.php?secret=invalid-install-probe')"
[[ "$webhook_status" == 401 || "$webhook_status" == 403 ]] || { echo "webhook درخواست بدون secret معتبر را با HTTP $webhook_status رد نکرد." >&2; exit 1; }
download_headers="$(curl -sSL --connect-timeout 10 --max-time 300 -D - -o /dev/null 'https://adlisho.online/download?verify=panel-install')"
grep -qi '^Content-Disposition:.*hamkare\.apk' <<<"$download_headers" || { echo 'نام وایت‌لیبل hamkare.apk در لینک عمومی فعال نشد.' >&2; exit 1; }
unset download_headers

INSTALL_COMPLETE=1
echo '✅ پنل مدیریت امن نصب شد.'
echo 'آدرس: https://seskia.online/admin.php'
echo 'مدیریت: توکن بات آپلود، مدیران مجاز، چت گزارش، کانال APK، آپلود مستقیم تا ۲۰۰ MB و rollback'
echo 'APK بدون بازکردن یا بررسی امضا منتشر می‌شود؛ اندازه و SHA-256 لینک عمومی کنترل می‌شود.'
echo 'دانلود ثابت سایت و دکمه بله: https://adlisho.online/download'
echo 'تنظیمات بات تلگرام و بله تغییر نکردند.'
echo "بکاپ قابل‌بازیابی: $SNAPSHOT"
