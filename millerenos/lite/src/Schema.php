<?php
declare(strict_types=1);

namespace Mlr;

use PDO;

/**
 * SQLite schema for shared hosting (the Node edition uses PostgreSQL + RLS). Tenant isolation here is enforced in
 * the application layer: every tenant query filters by workspace_id, covered by tests/run.php. Migrations are
 * append-only and tracked in schema_migrations.
 */
final class Schema
{
    private const MIGRATIONS = [
        '001_core' => <<<'SQL'
CREATE TABLE users (
  id TEXT PRIMARY KEY, telegram_user_id INTEGER UNIQUE, first_name TEXT NOT NULL DEFAULT '', username TEXT,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','fa')), locale_chosen INTEGER NOT NULL DEFAULT 0,
  platform_role TEXT NOT NULL DEFAULT 'user' CHECK (platform_role IN ('user','support','admin','superadmin')),
  is_blocked INTEGER NOT NULL DEFAULT 0, referred_by TEXT, created_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, revoked_at INTEGER);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE referral_codes (code TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, owner_user_id TEXT NOT NULL REFERENCES users(id),
  default_locale TEXT NOT NULL DEFAULT 'en', currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  store_published INTEGER NOT NULL DEFAULT 0, store_settings TEXT NOT NULL DEFAULT '{}',
  ai_mode TEXT NOT NULL DEFAULT 'SUGGEST_ONLY', business_policies TEXT NOT NULL DEFAULT '',
  order_seq INTEGER NOT NULL DEFAULT 1000, created_at INTEGER NOT NULL);
CREATE TABLE workspace_members (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK (role IN ('owner','admin','staff')),
  created_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, user_id));
CREATE INDEX members_user ON workspace_members(user_id);
CREATE TABLE plans (code TEXT PRIMARY KEY, price_stars INTEGER NOT NULL, period_days INTEGER NOT NULL, limits TEXT NOT NULL,
  price_usdt_micro INTEGER, price_trx_sun INTEGER, is_active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
INSERT INTO plans VALUES ('starter', 250, 30, '{"products":100,"ai_requests_per_day":50,"staff":1}', 5000000, 17000000, 1, 10);
INSERT INTO plans VALUES ('growth', 750, 30, '{"products":2000,"ai_requests_per_day":300,"staff":5}', 15000000, 50000000, 1, 20);
CREATE TABLE subscriptions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES plans(code), status TEXT NOT NULL CHECK (status IN ('active','cancelled','expired')),
  current_period_start INTEGER NOT NULL, current_period_end INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX subscriptions_one_active ON subscriptions(workspace_id) WHERE status = 'active';
CREATE TABLE trials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE, started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', converted_at INTEGER, notified INTEGER NOT NULL DEFAULT 0);
CREATE TABLE trial_claims (subject_hash TEXT PRIMARY KEY, claimed_at INTEGER NOT NULL);
CREATE TABLE products (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'physical' CHECK (kind IN ('physical','service','digital')), name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX products_ws ON products(workspace_id, status, created_at);
CREATE TABLE product_variants (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default', sku TEXT, price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  stock INTEGER CHECK (stock IS NULL OR stock >= 0), is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE INDEX variants_ws ON product_variants(workspace_id, product_id);
CREATE TABLE customers (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '', telegram_user_id INTEGER, created_at INTEGER NOT NULL, UNIQUE (workspace_id, telegram_user_id));
CREATE TABLE orders (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number INTEGER NOT NULL, customer_id TEXT, channel TEXT NOT NULL DEFAULT 'telegram',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','paid','fulfilled','cancelled','refunded')),
  currency TEXT NOT NULL, subtotal_minor INTEGER NOT NULL, discount_minor INTEGER NOT NULL DEFAULT 0, total_minor INTEGER NOT NULL,
  customer_note TEXT NOT NULL DEFAULT '', idempotency_key TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (workspace_id, number), UNIQUE (workspace_id, idempotency_key), CHECK (total_minor = subtotal_minor - discount_minor));
CREATE INDEX orders_ws ON orders(workspace_id, created_at);
CREATE TABLE order_items (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id TEXT, product_name TEXT NOT NULL, variant_name TEXT NOT NULL, unit_price_minor INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999), line_total_minor INTEGER NOT NULL);
CREATE TABLE order_status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, order_id TEXT NOT NULL,
  from_status TEXT, to_status TEXT NOT NULL, actor_user_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE invoices (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL, plan_code TEXT, payer_user_id TEXT, provider TEXT NOT NULL, currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0), status TEXT NOT NULL DEFAULT 'open',
  payload_nonce TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, paid_at INTEGER);
CREATE TABLE payments (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, invoice_id TEXT NOT NULL REFERENCES invoices(id),
  provider TEXT NOT NULL, provider_charge_id TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'succeeded', created_at INTEGER NOT NULL, UNIQUE (provider, provider_charge_id));
CREATE INDEX payments_invoice ON payments(invoice_id);
CREATE TABLE webhook_events (provider TEXT NOT NULL, event_id TEXT NOT NULL, received_at INTEGER NOT NULL, PRIMARY KEY (provider, event_id));
CREATE TABLE faq_entries (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question TEXT NOT NULL, answer TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE support_tickets (id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', subject TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE support_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id TEXT, is_staff INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT, actor_user_id TEXT, action TEXT NOT NULL,
  target_type TEXT, target_id TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
CREATE TABLE analytics_events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, user_id TEXT, workspace_id TEXT,
  props TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
CREATE INDEX analytics_name ON analytics_events(name, created_at);
CREATE TABLE account_deletion_requests (user_id TEXT PRIMARY KEY, requested_at INTEGER NOT NULL, execute_after INTEGER NOT NULL, completed_at INTEGER);
CREATE TABLE rate_limits (key TEXT NOT NULL, win INTEGER NOT NULL, hits INTEGER NOT NULL, PRIMARY KEY (key, win));
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
SQL,
    ];

    public static function migrate(PDO $pdo): void
    {
        $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
        $done = $pdo->query('SELECT name FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
        foreach (self::MIGRATIONS as $name => $sql) {
            if (in_array($name, $done, true)) continue;
            $pdo->exec('BEGIN IMMEDIATE');
            try {
                // re-check inside the lock: another request may have migrated meanwhile
                $st = $pdo->prepare('SELECT 1 FROM schema_migrations WHERE name = ?');
                $st->execute([$name]);
                if (!$st->fetch()) {
                    $pdo->exec($sql);
                    $pdo->prepare('INSERT INTO schema_migrations VALUES (?, ?)')->execute([$name, time()]);
                }
                $pdo->exec('COMMIT');
            } catch (\Throwable $e) {
                $pdo->exec('ROLLBACK');
                throw $e;
            }
        }
    }
}
