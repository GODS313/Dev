#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این تعمیر باید با root اجرا شود.' >&2; exit 1; }
for command_name in git nginx python3 systemctl curl realpath flock; do
  command -v "$command_name" >/dev/null || { echo "دستور لازم نصب نیست: $command_name" >&2; exit 1; }
done

exec 9>/run/lock/hamkare-runtime-repair.lock
flock -n 9 || { echo 'تعمیر دیگری هم‌زمان در حال اجراست.' >&2; exit 1; }

REPO_URL=https://github.com/GODS313/Dev.git
REPO_BRANCH="${REPO_BRANCH:-feat/hamkare-selfhosted-redesign}"
SITE_LINK=/etc/nginx/sites-enabled/adlisho
SITE_CONFIG="$(realpath -e -- "$SITE_LINK")"
SNIPPET=/etc/nginx/snippets/hamkare-runtime-locations.conf
WORK_DIR="$(mktemp -d)"
BACKUP_DIR="/var/backups/hamkare-runtime-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -a "$SITE_CONFIG" "$BACKUP_DIR/adlisho.conf"
SNIPPET_EXISTED=0
if [[ -f "$SNIPPET" && ! -L "$SNIPPET" ]]; then
  SNIPPET_EXISTED=1
  cp -a "$SNIPPET" "$BACKUP_DIR/hamkare-runtime-locations.conf"
fi

REPAIR_COMPLETE=0
cleanup() {
  local exit_code=$?
  rm -rf -- "$WORK_DIR"
  if [[ $REPAIR_COMPLETE -eq 0 ]]; then
    cp -a "$BACKUP_DIR/adlisho.conf" "$SITE_CONFIG"
    if [[ $SNIPPET_EXISTED -eq 1 ]]; then
      cp -a "$BACKUP_DIR/hamkare-runtime-locations.conf" "$SNIPPET"
    else
      rm -f -- "$SNIPPET"
    fi
    nginx -t >/dev/null 2>&1 && systemctl reload nginx.service || true
    echo "تعمیر ناموفق بود؛ تنظیمات Nginx از $BACKUP_DIR بازگردانده شد." >&2
  fi
  return "$exit_code"
}
trap cleanup EXIT

git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$WORK_DIR/repo"

install -d -o root -g root -m 0755 /etc/nginx/snippets
python3 - "$SNIPPET" <<'PY'
import os, sys, tempfile
target = sys.argv[1]
content = r'''# Hamkare: execute only explicitly approved PHP entry points.
location = /api/register {
    limit_except POST { deny all; }
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME /var/www/adlisho/register.php;
    fastcgi_param SCRIPT_NAME /register.php;
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    fastcgi_read_timeout 30s;
}

location = /admin/apk.php {
    client_max_body_size 205m;
    client_body_timeout 300s;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME /var/www/adlisho/admin/apk.php;
    fastcgi_param SCRIPT_NAME /admin/apk.php;
    fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    fastcgi_connect_timeout 30s;
    fastcgi_send_timeout 300s;
    fastcgi_read_timeout 300s;
}

# Serve the APK directly from this VPS. Nginx provides byte ranges itself,
# so downloads and panel verification do not consume a PHP-FPM worker.
location = /download {
    alias /var/www/adlisho/app.apk;
    default_type application/vnd.android.package-archive;
    add_header Content-Disposition 'attachment; filename="hamkare.apk"' always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Cache-Control 'public, max-age=300' always;
}

location = /download/ {
    return 308 /download;
}

# Never expose PHP source through the static-file fallback.
location ~ \.php$ {
    return 404;
}
'''
directory = os.path.dirname(target)
fd, temporary = tempfile.mkstemp(prefix='.hamkare-runtime-', dir=directory)
try:
    os.fchmod(fd, 0o644)
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, target)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

python3 - "$SITE_CONFIG" <<'PY'
import os, re, sys, tempfile
path = sys.argv[1]
include_line = '    include /etc/nginx/snippets/hamkare-runtime-locations.conf;'
text = open(path, encoding='utf-8').read()
if include_line.strip() in text:
    raise SystemExit(0)

def closing_brace(source, opening):
    depth = 0
    quote = None
    escaped = False
    comment = False
    for i in range(opening, len(source)):
        ch = source[i]
        if comment:
            if ch == '\n':
                comment = False
            continue
        if quote:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == quote:
                quote = None
            continue
        if ch == '#':
            comment = True
        elif ch in ('"', "'"):
            quote = ch
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return i
    raise RuntimeError('پایان server block پیدا نشد.')

matches = []
for match in re.finditer(r'(?m)^\s*server\s*\{', text):
    opening = text.find('{', match.start())
    end = closing_brace(text, opening)
    block = text[match.start():end + 1]
    if re.search(r'\blisten\s+[^;]*443\b', block) and re.search(r'\bserver_name\s+[^;]*\badlisho\.online\b', block):
        matches.append(end)
if len(matches) != 1:
    raise RuntimeError(f'باید دقیقاً یک server block HTTPS برای adlisho.online پیدا شود؛ تعداد: ${len(matches)}')
position = matches[0]
updated = text[:position].rstrip() + '\n\n' + include_line + '\n' + text[position:]
fd, temporary = tempfile.mkstemp(prefix='.adlisho-nginx-', dir=os.path.dirname(path))
try:
    os.fchmod(fd, os.stat(path).st_mode & 0o777)
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        output.write(updated)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

nginx -t
systemctl reload nginx.service

bash "$WORK_DIR/repo/install-hamkare-apk-panel.sh"

api_code="$(curl -sS --connect-timeout 10 --max-time 20 --resolve adlisho.online:443:127.0.0.1 -o "$WORK_DIR/api.json" -w '%{http_code}' -X POST https://adlisho.online/api/register -H 'Content-Type: application/json' --data '{}')"
[[ "$api_code" == 400 ]] || { echo "مسیر فرم پاسخ غیرمنتظره HTTP $api_code داد." >&2; exit 1; }
python3 - "$WORK_DIR/api.json" <<'PY'
import json, sys
body = json.load(open(sys.argv[1], encoding='utf-8'))
if body.get('ok') is not False or not body.get('error'):
    raise SystemExit('پاسخ JSON فرم معتبر نیست.')
PY

source_code="$(curl -sS --connect-timeout 10 --max-time 20 --resolve adlisho.online:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://adlisho.online/register.php)"
[[ "$source_code" == 404 ]] || { echo "محافظت سورس PHP پاسخ HTTP $source_code داد." >&2; exit 1; }
panel_type="$(curl -sSI --connect-timeout 10 --max-time 20 --resolve adlisho.online:443:127.0.0.1 https://adlisho.online/admin/apk.php | tr -d '\r' | awk 'tolower($1)=="content-type:"{print tolower($2);exit}')"
[[ "$panel_type" == text/html* ]] || { echo "پنل با Content-Type نامعتبر پاسخ داد: $panel_type" >&2; exit 1; }
download_code="$(curl -sS --connect-timeout 10 --max-time 30 --resolve adlisho.online:443:127.0.0.1 -o "$WORK_DIR/download.apk" -w '%{http_code}' https://adlisho.online/download)"
[[ "$download_code" == 200 ]] || { echo "لینک مستقیم APK پاسخ HTTP $download_code داد." >&2; exit 1; }
cmp -s /var/www/adlisho/app.apk "$WORK_DIR/download.apk" || { echo 'فایل لینک دانلود با APK سرور یکسان نیست.' >&2; exit 1; }

REPAIR_COMPLETE=1
echo '✅ فرم ثبت درخواست فعال شد.'
echo '✅ دانلود سورس PHP مسدود شد.'
echo '✅ پنل آپلود APK فعال شد: https://adlisho.online/admin/apk.php'
echo '✅ لینک ثابت APK مستقیماً از همین VPS: https://adlisho.online/download'
echo "بکاپ تنظیمات: $BACKUP_DIR"
