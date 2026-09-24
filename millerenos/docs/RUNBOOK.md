# Runbook

## Health signals
| Check | Where | Healthy |
|---|---|---|
| Liveness | `GET /healthz` | 200 |
| Readiness (DB) | `GET /readyz` | 200 `{db:"up"}` |
| Metrics | `GET /metrics` (bearer) | `http_request_duration_seconds`, `telegram_updates_total{result}` |
| Admin dashboard | Mini App → More → Platform admin | DB latency, job stats, failed jobs, last backup/restore test, integrations |
| Logs | stdout JSON (pino) | each line has `reqId`; secrets redacted |

## Common incidents
**Bot not responding** — check `telegram_updates_total{result="rejected"}` (webhook secret mismatch → re-run setWebhook),
`getWebhookInfo` (`last_error_message`), `/readyz`. Errors in handlers are logged as `bot handler failed`.

**Payments: "needs review"** — admin dashboard counter `payments_needing_review`. Look up `audit_logs action=payment.needs_review`.
Either apply manually (extend subscription via SQL in a transaction, audited) or refund via `POST /api/admin/payments/:id/refund`.

**Trial expiry notifications not sent** — worker running? `jobs` with `status='failed'` in admin health; fix cause, then
`UPDATE jobs SET status='queued', attempts=0 WHERE id=…`.

**Database down** — `/readyz` 503. Restart DB container; if data is lost, follow "Restore production".

**Suspected secret leak** — rotate immediately: bot token (@BotFather → revoke), `TELEGRAM_WEBHOOK_SECRET` (setWebhook again),
DB passwords (re-run bootstrap-roles.sql with new values), `DATA_HASH_SECRET` (note: rotating it re-allows trials for
previous users — only rotate if leaked), `ANTHROPIC_API_KEY`, `METRICS_TOKEN`. Revoke all sessions:
`UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL`.

**Abuse** — block a user: `POST /api/admin/users/:id/block` (revokes sessions, audited). Suspend a workspace:
`POST /api/admin/workspaces/:id/status`. Disable a feature globally: `PATCH /api/admin/flags/:key {enabled:false}`.

## Restore production
1. Announce maintenance; stop `app` and `worker`.
2. Take a backup of the current (broken) state for forensics.
3. Restore the chosen backup into a **new** database (BACKUP_RESTORE.md), point `DATABASE_*` URLs at it, start `migrate`, `app`, `worker`.
4. Verify `/readyz`, admin dashboard, a test order in staging-like flow. Record the incident in CHANGELOG and a postmortem.
