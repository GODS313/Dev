#!/usr/bin/env bash
# Restores an encrypted backup into TARGET_DATABASE_URL (an EMPTY database owned by millerenos_owner).
# Run as a superuser connection: tables use FORCE ROW LEVEL SECURITY, and roles from
# ops/db/bootstrap-roles.sql must already exist on the target cluster.
# Usage: AGE_IDENTITY=/secure/key.txt TARGET_DATABASE_URL=postgres://... restore.sh <file.dump.age>
# Never point this at the production database without a fresh backup and explicit approval.
set -euo pipefail
file="${1:?backup file required}"
: "${AGE_IDENTITY:?}" "${TARGET_DATABASE_URL:?}"
if [[ -f "$file.sha256" ]]; then sha256sum -c "$file.sha256" >/dev/null; fi
count="$(psql "$TARGET_DATABASE_URL" -qAt -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
if [[ "$count" != "0" && "${ALLOW_NON_EMPTY:-}" != "yes" ]]; then
  echo "target database is not empty; refusing (set ALLOW_NON_EMPTY=yes to override)" >&2
  exit 1
fi
age -d -i "$AGE_IDENTITY" "$file" | pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET_DATABASE_URL"
echo "restore ok: $file"
