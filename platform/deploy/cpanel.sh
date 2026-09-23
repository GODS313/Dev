#!/usr/bin/env bash
# Minimal cPanel API client for CI. Uses a session login (this host rejects Basic auth).
# Usage: cpanel.sh uapi 'Module/function?arg=v'   |   cpanel.sh api2 'cpanel_jsonapi_module=..&..'
set -euo pipefail
: "${CPANEL_HOST:?}" "${CPANEL_USER:?}" "${CPANEL_PASSWORD:?}"
jar="${RUNNER_TEMP:-/tmp}/cpanel.cookies"
tokfile="${RUNNER_TEMP:-/tmp}/cpanel.token"
base="https://$CPANEL_HOST:2083"

if [ ! -s "$tokfile" ]; then
  resp=$(curl -sS -m 30 -c "$jar" -X POST "$base/login/?login_only=1" \
    --data-urlencode "user=$CPANEL_USER" --data-urlencode "pass=$CPANEL_PASSWORD")
  token=$(printf '%s' "$resp" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("security_token","") if d.get("status")==1 else "")' 2>/dev/null || true)
  if [ -z "$token" ]; then
    echo "cPanel login failed; response summary:" >&2
    printf '%s' "$resp" | python3 -c '
import json,sys
raw=sys.stdin.read()
try:
    d=json.loads(raw); print({k:(v if k in ("status","message","reason","redirect","notices") else "...") for k,v in d.items()})
except Exception:
    print("non-JSON response, first bytes:", raw[:160].replace("\n"," "))
' >&2
    exit 1
  fi
  echo "::add-mask::$token"
  printf '%s' "$token" > "$tokfile"
fi
token=$(cat "$tokfile")

case "$1" in
  uapi) curl -sS -m 60 -b "$jar" "$base$token/execute/$2" ;;
  api2) curl -sS -m 60 -b "$jar" "$base$token/json-api/cpanel?cpanel_jsonapi_user=$CPANEL_USER&cpanel_jsonapi_apiversion=2&$2" ;;
  *) echo "usage: $0 uapi|api2 <query>" >&2; exit 2 ;;
esac
