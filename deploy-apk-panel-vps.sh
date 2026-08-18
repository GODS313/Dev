#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $EUID -eq 0 ]] || { echo 'این دستور باید با sudo/root اجرا شود.' >&2; exit 1; }
for command_name in flock git; do
  command -v "$command_name" >/dev/null || { echo "دستور لازم نصب نیست: $command_name" >&2; exit 1; }
done

exec 9>/run/lock/hamkare-apk-panel-deploy.lock
flock -n 9 || { echo 'نصب دیگری هم‌زمان در حال اجراست.' >&2; exit 1; }

REPO_URL=https://github.com/GODS313/Dev.git
REPO_BRANCH=main
TEMP_DIR="$(mktemp -d)"
cleanup() { rm -rf -- "$TEMP_DIR"; }
trap cleanup EXIT

git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$TEMP_DIR/repo"
bash "$TEMP_DIR/repo/install-hamkare-apk-panel.sh"
