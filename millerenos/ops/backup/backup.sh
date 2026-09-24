#!/usr/bin/env bash
# Encrypted PostgreSQL backup. Encrypts with an age PUBLIC key; the private key is kept offline.
# Required env: BACKUP_DATABASE_URL (role millerenos_backup — BYPASSRLS, read-only), BACKUP_DIR, BACKUP_AGE_RECIPIENT (age1...)
# Optional: BACKUP_RETENTION_DAYS (default 30), BACKUP_RECORD_URL (system role, records status for the admin dashboard)
set -euo pipefail
umask 077
: "${BACKUP_DATABASE_URL:?}" "${BACKUP_DIR:?}" "${BACKUP_AGE_RECIPIENT:?}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/millerenos-$ts.dump.age"
tmp="$out.partial"

record() {
  [[ -n "${BACKUP_RECORD_URL:-}" ]] || return 0
  psql "$BACKUP_RECORD_URL" -qAt -v ON_ERROR_STOP=1 -v status="$1" -v detail="$2" >/dev/null \
    <<<"INSERT INTO backup_runs (kind, status, detail) VALUES ('backup', :'status', :'detail')" || true
}
trap 'rm -f "$tmp"; record failed "backup $ts failed"' ERR

pg_dump --format=custom --no-owner --no-privileges "$BACKUP_DATABASE_URL" | age -r "$BACKUP_AGE_RECIPIENT" -o "$tmp"
mv "$tmp" "$out"
sha256sum "$out" > "$out.sha256"
find "$BACKUP_DIR" -name 'millerenos-*.dump.age*' -mtime +"$RETENTION" -delete
size="$(du -h "$out" | cut -f1)"
record succeeded "$(basename "$out") $size"
echo "backup ok: $out ($size)"
