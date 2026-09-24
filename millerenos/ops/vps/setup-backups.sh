#!/usr/bin/env bash
# Encrypted daily-ish backups of the Docker PostgreSQL (every 6 h), kept 30 days, plus a weekly restore test.
# The age private key is generated on this server; COPY IT OFF THE SERVER (password manager) — without it
# backups cannot be restored, and a key that only lives on the same server does not protect against server loss.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KEY=/root/millerenos-backup-key.txt
DIR=/var/backups/millerenos
install -d -m 700 "$DIR"
[[ -f "$KEY" ]] || { age-keygen -o "$KEY" 2>/dev/null; chmod 600 "$KEY"; }
RECIPIENT="$(grep -o 'age1[0-9a-z]*' "$KEY" | head -n1)"

cat >/usr/local/sbin/millerenos-backup <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$ROOT/ops"
set -a; source .env; set +a
ts=\$(date -u +%Y%m%dT%H%M%SZ)
out="$DIR/millerenos-\$ts.dump.age"
record() { docker compose exec -T -e PGPASSWORD="\$DB_SYSTEM_PASSWORD" db psql -h 127.0.0.1 -U millerenos_system -d millerenos -q \
  -c "INSERT INTO backup_runs (kind, status, detail) VALUES ('\$1', '\$2', '\$3')" >/dev/null || true; }
if docker compose exec -T -e PGPASSWORD="\$DB_BACKUP_PASSWORD" db pg_dump -h 127.0.0.1 -U millerenos_backup -d millerenos -Fc --no-owner --no-privileges \
   | age -r "$RECIPIENT" -o "\$out.partial"; then
  mv "\$out.partial" "\$out"; sha256sum "\$out" > "\$out.sha256"
  find "$DIR" -name 'millerenos-*.dump.age*' -mtime +30 -delete
  record backup succeeded "\$(basename "\$out") \$(du -h "\$out" | cut -f1)"
else
  rm -f "\$out.partial"; record backup failed "backup \$ts failed"; exit 1
fi
if [[ "\${1:-}" == "--restore-test" ]]; then
  scratch="restore_test_\$(date +%s)"
  docker compose exec -T db psql -U postgres -q -c "CREATE DATABASE \$scratch"
  if age -d -i "$KEY" "\$out" | docker compose exec -T db pg_restore -U postgres --no-owner --no-privileges --exit-on-error -d "\$scratch"; then
    n=\$(docker compose exec -T db psql -U postgres -d "\$scratch" -qAt -c 'SELECT count(*) FROM schema_migrations')
    record restore_test succeeded "\$(basename "\$out"): migrations=\$n"
  else
    record restore_test failed "\$(basename "\$out")"
  fi
  docker compose exec -T db psql -U postgres -q -c "DROP DATABASE IF EXISTS \$scratch WITH (FORCE)"
fi
SCRIPT
chmod 700 /usr/local/sbin/millerenos-backup

cat >/etc/systemd/system/millerenos-backup.service <<UNIT
[Unit]
Description=Millerenos encrypted backup
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/millerenos-backup
UNIT
cat >/etc/systemd/system/millerenos-backup.timer <<UNIT
[Unit]
Description=Millerenos backup every 6 hours
[Timer]
OnCalendar=*-*-* 00/6:15:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
cat >/etc/systemd/system/millerenos-restore-test.service <<UNIT
[Unit]
Description=Millerenos backup + restore test
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/millerenos-backup --restore-test
UNIT
cat >/etc/systemd/system/millerenos-restore-test.timer <<UNIT
[Unit]
Description=Weekly Millerenos restore test
[Timer]
OnCalendar=Sun *-*-* 04:30:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now millerenos-backup.timer millerenos-restore-test.timer >/dev/null
/usr/local/sbin/millerenos-backup --restore-test && echo "backup + restore test: OK"
echo "کلید بازیابی پشتیبان: $KEY — یک نسخه از آن را خارج از سرور نگه دارید."
