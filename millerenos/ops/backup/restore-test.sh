#!/usr/bin/env bash
# Proves the latest backup can be restored: restores into a scratch database, runs sanity
# checks, records the result, then drops the scratch database. Run at least weekly.
# Required env: BACKUP_DIR, AGE_IDENTITY, ADMIN_DATABASE_URL (superuser, to create/drop scratch DB)
# Optional: BACKUP_RECORD_URL (system role on production DB)
set -euo pipefail
: "${BACKUP_DIR:?}" "${AGE_IDENTITY:?}" "${ADMIN_DATABASE_URL:?}"
latest="$(ls -1t "$BACKUP_DIR"/millerenos-*.dump.age | head -n1)"
scratch="millerenos_restore_test_$(date -u +%s)"
record() {
  [[ -n "${BACKUP_RECORD_URL:-}" ]] || return 0
  psql "$BACKUP_RECORD_URL" -qAt -v ON_ERROR_STOP=1 -v status="$1" -v detail="$2" >/dev/null \
    <<<"INSERT INTO backup_runs (kind, status, detail) VALUES ('restore_test', :'status', :'detail')" || true
}
cleanup() { psql "$ADMIN_DATABASE_URL" -qAt -c "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" >/dev/null; }
trap 'cleanup; record failed "restore test of $(basename "$latest") failed"' ERR
psql "$ADMIN_DATABASE_URL" -qAt -c "CREATE DATABASE $scratch"
scratch_url="$(sed -E "s#/[^/?]+(\?|$)#/$scratch\1#" <<<"$ADMIN_DATABASE_URL")"
AGE_IDENTITY="$AGE_IDENTITY" TARGET_DATABASE_URL="$scratch_url" bash "$(dirname "$0")/restore.sh" "$latest"
migrations="$(psql "$scratch_url" -qAt -c 'SELECT count(*) FROM schema_migrations')"
users="$(psql "$scratch_url" -qAt -c 'SELECT count(*) FROM users')"
workspaces="$(psql "$scratch_url" -qAt -c 'SELECT count(*) FROM workspaces')"
[[ "$migrations" -ge 1 ]]
cleanup
trap - ERR
record succeeded "$(basename "$latest"): migrations=$migrations users=$users workspaces=$workspaces"
echo "restore test ok: $(basename "$latest") migrations=$migrations users=$users workspaces=$workspaces"
