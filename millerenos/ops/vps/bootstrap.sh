#!/usr/bin/env bash
# نصب یک‌مرحله‌ای Millerenos روی سرور مجازی (Ubuntu/Debian). اجرا با root:
#   curl -fsSLo /tmp/millerenos.sh https://raw.githubusercontent.com/GODS313/Dev/claude/millerenos-master-build-pbex95/millerenos/ops/vps/bootstrap.sh && sudo bash /tmp/millerenos.sh
# توکن ربات به‌صورت مخفی پرسیده می‌شود و فقط روی همین سرور (فایل با دسترسی 600) ذخیره می‌شود.
set -Eeuo pipefail
umask 022
BRANCH="${MILLERENOS_BRANCH:-claude/millerenos-master-build-pbex95}"
REPO="https://github.com/GODS313/Dev.git"
SRC=/opt/millerenos-src
ROOT="$SRC/millerenos"
say() { printf '\n\033[1;32m== %s ==\033[0m\n' "$1"; }
die() { printf '\033[1;31mخطا: %s\033[0m\n' "$1" >&2; exit 1; }
trap 'die "نصب در خط $LINENO متوقف شد. خروجی بالا را برای پشتیبانی بفرستید (بدون رمز یا توکن)."' ERR

[[ $EUID -eq 0 ]] || die 'این نصب‌کننده باید با sudo یا root اجرا شود.'
command -v apt-get >/dev/null || die 'فقط Ubuntu/Debian پشتیبانی می‌شود.'

say 'نصب پیش‌نیازها'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl age >/dev/null
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  say 'نصب Docker (اسکریپت رسمی docker.com)'
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh >/dev/null
fi
systemctl enable --now docker >/dev/null

say 'دریافت کد Millerenos'
if [[ -d "$SRC/.git" ]]; then
  git -C "$SRC" fetch -q --depth 1 origin "$BRANCH" && git -C "$SRC" checkout -q -B "$BRANCH" FETCH_HEAD
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$SRC"
fi

ENV_FILE="$ROOT/ops/.env"
if [[ -f "$ENV_FILE" ]]; then
  PUBLIC_BASE_URL="$(grep -E '^PUBLIC_BASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
else
  say 'آدرس سامانه'
  IP="$(curl -4 -fsS -m 10 https://api.ipify.org || true)"
  [[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'IP عمومی سرور پیدا نشد.'
  AUTO="${IP//./-}.sslip.io"
  echo "اگر دامنه یا زیردامنه‌ای دارید که به IP این سرور ($IP) اشاره می‌کند، آن را وارد کنید."
  echo "اگر ندارید فقط Enter بزنید تا آدرس خودکار $AUTO استفاده شود."
  read -rp 'دامنه: ' DOMAIN </dev/tty || true
  DOMAIN="${DOMAIN:-$AUTO}"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die 'دامنه نامعتبر است.'
  PUBLIC_BASE_URL="https://$DOMAIN/God"
fi
DOMAIN="$(sed -E 's#^https://([^/]+).*#\1#' <<<"$PUBLIC_BASE_URL")"
echo "آدرس سامانه: $PUBLIC_BASE_URL"

say 'بررسی پورت‌های 80 و 443'
USE_CADDY=yes
if ss -ltnp 2>/dev/null | grep -E ':(80|443)\s' | grep -vq docker-proxy; then
  USE_CADDY=no
  echo 'روی این سرور وب‌سرور دیگری پورت 80/443 را گرفته است؛ Caddy نصب نمی‌شود و باید پراکسی دستی اضافه شود (راهنما در پایان).'
fi
if [[ "$USE_CADDY" == yes ]]; then
  cat >"$ROOT/ops/Caddyfile" <<CADDY
$DOMAIN {
	encode zstd gzip
	redir / /God/ 302
	handle /God* {
		reverse_proxy app:8080
	}
	respond 404
}
CADDY
fi

say 'نصب و راه‌اندازی (ممکن است چند دقیقه طول بکشد)'
PUBLIC_BASE_URL="$PUBLIC_BASE_URL" bash "$ROOT/ops/etebarami/install.sh"
if [[ "$USE_CADDY" == yes ]]; then
  docker compose -f "$ROOT/ops/docker-compose.yml" --profile proxy up -d caddy
  say 'دریافت گواهی HTTPS'
  ok=no
  for _ in $(seq 1 45); do curl -fsS -m 10 "$PUBLIC_BASE_URL/readyz" >/dev/null 2>&1 && { ok=yes; break; }; sleep 4; done
  [[ "$ok" == yes ]] || die "آدرس $PUBLIC_BASE_URL از اینترنت در دسترس نشد. فایروال پورت‌های 80 و 443 را باز کنید و دوباره همین دستور را اجرا کنید."
  say 'اتصال ربات تلگرام'
  bash "$ROOT/ops/etebarami/set-webhook.sh"
fi

say 'پشتیبان‌گیری خودکار'
bash "$ROOT/ops/vps/setup-backups.sh"

say 'تمام شد'
cat <<DONE
سایت:        $PUBLIC_BASE_URL/fa/
مینی‌اپ:     $PUBLIC_BASE_URL/app/
سلامت:       $PUBLIC_BASE_URL/readyz
ربات را در تلگرام باز کنید و /start بزنید.
به‌روزرسانی بعدی: همین دستور را دوباره اجرا کنید (اطلاعات و تنظیمات حفظ می‌شود).
DONE
if [[ "$USE_CADDY" == no ]]; then
  echo "پراکسی دستی: مسیر /God را بدون حذف پیشوند به http://127.0.0.1:8080 بفرستید، سپس: bash $ROOT/ops/etebarami/set-webhook.sh"
fi
