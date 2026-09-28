#!/usr/bin/env bash
set -euo pipefail
root=$(mktemp -d)
cp -a sms-test "$root/app"
php sms-test/tests/prepare_api_test.php "$root/app"
token=$(cat "$root/app/tests/api-test-token")
rm -f "$root/app/tests/api-test-token"
port=18765
php -S "127.0.0.1:$port" -t "$root/app" "$root/app/tests/router.php" >"$root/php-server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; rm -rf "$root"' EXIT
for _ in $(seq 1 30); do
  if curl -sS "http://127.0.0.1:$port/" >/dev/null 2>&1; then break; fi
  sleep 1
done
unauth=$(curl -sS -o "$root/unauth.json" -w '%{http_code}' -X POST "http://127.0.0.1:$port/api/gateway/inbox" -H 'X-Forwarded-Proto: https' -H 'Content-Type: application/json' -d '{}')
test "$unauth" = 401
payload='{"remote_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","phone":"+989120000000","body":"authorized test","received_at":"2026-09-28T10:00:00Z"}'
first=$(curl -fsS -X POST "http://127.0.0.1:$port/api/gateway/inbox" -H 'X-Forwarded-Proto: https' -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "$payload")
second=$(curl -fsS -X POST "http://127.0.0.1:$port/api/gateway/inbox" -H 'X-Forwarded-Proto: https' -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "$payload")
python3 - "$first" "$second" <<'PY'
import json,sys
first,second=(json.loads(v) for v in sys.argv[1:])
assert first == {'ok': True, 'inserted': True}, first
assert second == {'ok': True, 'inserted': False}, second
print('Authenticated Inbox insert and duplicate suppression: OK')
PY
no_bot=$(curl -sS -o "$root/enroll.json" -w '%{http_code}' -X POST "http://127.0.0.1:$port/api/gateway/enrollment/request" -H 'X-Forwarded-Proto: https' -H 'Content-Type: application/json' -d '{"request_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","poll_secret":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","device_name":"test"}')
test "$no_bot" = 503
python3 - "$root/enroll.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['error']=='telegram_admin_not_configured'
print('Enrollment fails closed when Telegram admin is not configured: OK')
PY

