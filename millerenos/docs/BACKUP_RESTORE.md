# Backup & restore

| Item | Value |
|---|---|
| Method | `pg_dump --format=custom` by role `millerenos_backup` (read-only, `BYPASSRLS` so every tenant is included) |
| Encryption | `age` with a **public** key on the server; the private key is stored offline (password manager + paper copy) |
| Schedule | every 6 hours (`ops/systemd/millerenos-backup.timer`) |
| Retention | 30 days locally (`BACKUP_RETENTION_DAYS`); copy daily to off-site object storage with its own retention (e.g. 90 days, versioning + object lock) |
| Integrity | `sha256sum` sidecar file, verified before restore |
| Restore test | weekly (`millerenos-restore-test.timer`): restores latest backup into a scratch DB, checks schema and row counts, drops it |
| Monitoring | both jobs write to `backup_runs`; the admin health dashboard shows the latest results |
| Targets | RPO ≤ 6 h, RTO ≤ 2 h (single host) |

## Setup
```bash
age-keygen -o millerenos-backup.key      # do this on an offline machine; keep the file secret
grep 'public key' millerenos-backup.key  # → age1…  (goes into BACKUP_AGE_RECIPIENT)
```
`/etc/millerenos/backup.env` (mode 600):
```
BACKUP_DATABASE_URL=postgres://millerenos_backup:…@localhost/millerenos
BACKUP_DIR=/var/backups/millerenos
BACKUP_AGE_RECIPIENT=age1…
BACKUP_RECORD_URL=postgres://millerenos_system:…@localhost/millerenos
```
Then `systemctl enable --now millerenos-backup.timer millerenos-restore-test.timer`.
The restore test needs the private key on the host running it; prefer running it on a separate, locked-down machine.

## Restore (disaster recovery)
1. Provision PostgreSQL 16, run `ops/db/bootstrap-roles.sql` (creates roles and an empty DB).
2. As a superuser connection: `AGE_IDENTITY=… TARGET_DATABASE_URL=postgres://postgres:…@host/millerenos ops/backup/restore.sh <file>`
   (the script refuses to write into a non-empty database).
3. Start the app; `migrate` applies any newer migrations. Verify with `/readyz` and the admin dashboard.

## Validation performed
2026-09-24 (dev environment): backup created and encrypted (120 KB), restore test passed —
`migrations=1 users=3 workspaces=2`, both runs recorded in `backup_runs`. This test found and fixed a real defect
(owner-role dumps fail under forced RLS). A backup that has never been restored is not considered valid.
