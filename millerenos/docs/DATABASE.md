# Database

PostgreSQL 16. Schema lives in `apps/server/src/migrations/NNN_name.sql`, applied in order by `src/db/migrate.ts`
(advisory lock; each file in its own transaction; SHA-256 checksum stored in `schema_migrations` — editing an applied
migration fails the deploy). **Never change production schema by hand.** New change = new migration file.

## Tenancy
- Tenant root: `workspaces`. Tenant tables carry `workspace_id` and have RLS `ENABLE` + `FORCE` with policy
  `workspace_id = app_current_workspace()` for role `millerenos_app`, and `system_all` for `millerenos_system`.
- Child tables reference parents with composite FKs `(workspace_id, id)`, so a row can never point into another tenant.
- `Db.tenant(workspaceId, fn)` opens a transaction and `set_config('app.workspace_id', …, true)` (transaction-local).

## Entities (Phase 1)

| Area | Tables |
|---|---|
| Identity | `users`, `sessions` (hashed tokens), `referral_codes` |
| Tenancy | `workspaces`, `workspace_members (owner/admin/staff)` |
| Plans | `plans`, `subscriptions` (one active per workspace), `trials` (one per user, never deleted on expiry), `trial_claims` (HMAC of Telegram id), `usage_counters` (atomic quotas) |
| Commerce | `categories`, `products`, `product_variants` (price in minor units, nullable stock), `customers`, `coupons`, `orders` (per-workspace number, idempotency key, `total = subtotal - discount` check), `order_items` (price snapshots), `order_status_history` |
| Payments | `invoices` (payload nonce), `payment_attempts`, `payments` (unique provider charge id), `refunds`, `webhook_events` (dedupe) |
| AI | `faq_entries`, `ai_requests` (audit, review status) |
| CRM foundation | `consents` (opt-in/out per channel & purpose), `connected_accounts` |
| Platform | `audit_logs`, `analytics_events`, `feature_flags`, `jobs` (queue), `support_tickets`, `support_messages`, `account_deletion_requests`, `backup_runs` |

Money is always `bigint` minor units + ISO currency. Telegram ids are `bigint` and are returned to JS as strings.

## Phase 2 tables (planned, not created)
`conversations`, `messages`, `leads`, `tags`, `notes`, `campaigns`, `campaign_recipients`, `automations`,
`suppression_list`, `domains`, `hosting_accounts`. They will follow the same RLS + composite-FK pattern.

## Local setup
```bash
sudo -u postgres psql -v owner_pw=… -v app_pw=… -v system_pw=… -v backup_pw=… -v db=millerenos -f ops/db/bootstrap-roles.sql
DATABASE_MIGRATION_URL=postgres://millerenos_owner:…@localhost/millerenos npm run migrate
```
