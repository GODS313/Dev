-- Millerenos core schema (Phase 1).
-- Roles millerenos_app and millerenos_system must exist (see ops/db/bootstrap-roles.sql).
-- Tenant tables carry workspace_id and are protected by row-level security:
--   * millerenos_app    → only rows of the workspace set via SET LOCAL app.workspace_id
--   * millerenos_system → all rows (admin, worker, public store resolution)

CREATE OR REPLACE FUNCTION app_current_workspace() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.workspace_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ───────────────────────────── Identity (global) ─────────────────────────────

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint UNIQUE,
  first_name       text NOT NULL DEFAULT '' CHECK (length(first_name) <= 128),
  username         text CHECK (length(username) <= 64),
  locale           text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'fa')),
  locale_chosen    boolean NOT NULL DEFAULT false,
  platform_role    text NOT NULL DEFAULT 'user'
                   CHECK (platform_role IN ('user', 'support', 'admin', 'superadmin')),
  is_blocked       boolean NOT NULL DEFAULT false,
  referred_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE referral_codes (
  code       text PRIMARY KEY CHECK (code ~ '^[a-z0-9]{6,16}$'),
  user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────── Workspaces (tenant root) ──────────────────────

CREATE TABLE workspaces (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  owner_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  default_locale   text NOT NULL DEFAULT 'en' CHECK (default_locale IN ('en', 'fa')),
  currency         char(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  store_published  boolean NOT NULL DEFAULT false,
  store_settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_mode          text NOT NULL DEFAULT 'SUGGEST_ONLY'
                   CHECK (ai_mode IN ('MANUAL', 'SUGGEST_ONLY', 'APPROVAL_REQUIRED', 'AUTO_ALLOWED')),
  business_policies text NOT NULL DEFAULT '' CHECK (length(business_policies) <= 4000),
  order_seq        bigint NOT NULL DEFAULT 1000,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspaces_owner_idx ON workspaces(owner_user_id);
CREATE TRIGGER workspaces_updated BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members(user_id);

-- ───────────────────────────── Plans, subscriptions, trials ──────────────────

CREATE TABLE plans (
  code         text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,32}$'),
  price_stars  integer NOT NULL CHECK (price_stars >= 0),
  period_days  integer NOT NULL CHECK (period_days > 0),
  limits       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active    boolean NOT NULL DEFAULT true,
  sort         integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_code            text NOT NULL REFERENCES plans(code),
  status               text NOT NULL CHECK (status IN ('active', 'cancelled', 'expired')),
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL CHECK (current_period_end > current_period_start),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_ws_idx ON subscriptions(workspace_id, current_period_end DESC);
CREATE UNIQUE INDEX subscriptions_one_active ON subscriptions(workspace_id) WHERE status = 'active';
CREATE TRIGGER subscriptions_updated BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One legitimate trial per user, ever (unique user_id; the row is never deleted on expiry).
CREATE TABLE trials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'converted')),
  expired_notified_at timestamptz,
  converted_at  timestamptz,
  CHECK (expires_at > started_at)
);
CREATE INDEX trials_active_expiry_idx ON trials(expires_at) WHERE status = 'active';

-- Keyed hash (HMAC) of the Telegram id that claimed a trial. Survives account deletion so a
-- deleted-and-recreated account cannot farm a second trial. Holds no other personal data.
CREATE TABLE trial_claims (
  subject_hash bytea PRIMARY KEY,
  claimed_at   timestamptz NOT NULL DEFAULT now()
);

-- Quota counters (AI requests, products created, ...) per workspace per window.
CREATE TABLE usage_counters (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric       text NOT NULL CHECK (metric ~ '^[a-z_]{2,40}$'),
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (workspace_id, metric, window_start)
);

-- ───────────────────────────── Commerce ──────────────────────────────────────

CREATE TABLE categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  sort         integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE INDEX categories_ws_idx ON categories(workspace_id, sort);

CREATE TABLE products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category_id  uuid,
  kind         text NOT NULL DEFAULT 'physical' CHECK (kind IN ('physical', 'service', 'digital')),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description  text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  -- composite FK keeps a product's category inside the same workspace
  FOREIGN KEY (workspace_id, category_id) REFERENCES categories(workspace_id, id) ON DELETE SET NULL (category_id)
);
CREATE INDEX products_ws_status_idx ON products(workspace_id, status, created_at DESC);
CREATE TRIGGER products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_variants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  product_id   uuid NOT NULL,
  name         text NOT NULL DEFAULT 'Default' CHECK (length(name) BETWEEN 1 AND 80),
  sku          text CHECK (length(sku) <= 64),
  price_minor  bigint NOT NULL CHECK (price_minor >= 0),
  stock        integer CHECK (stock >= 0), -- NULL = not tracked
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, product_id) REFERENCES products(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX variants_product_idx ON product_variants(workspace_id, product_id);
CREATE UNIQUE INDEX variants_sku_uq ON product_variants(workspace_id, sku) WHERE sku IS NOT NULL;

CREATE TABLE customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name     text NOT NULL DEFAULT '' CHECK (length(display_name) <= 128),
  telegram_user_id bigint,
  phone            text CHECK (length(phone) <= 32),
  note             text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE UNIQUE INDEX customers_tg_uq ON customers(workspace_id, telegram_user_id) WHERE telegram_user_id IS NOT NULL;
CREATE TRIGGER customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE coupons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code            text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
  kind            text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value           bigint NOT NULL CHECK (value > 0),
  max_redemptions integer CHECK (max_redemptions > 0),
  redeemed_count  integer NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
  starts_at       timestamptz,
  ends_at         timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code),
  UNIQUE (workspace_id, id),
  CHECK (kind <> 'percent' OR value <= 100)
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number           bigint NOT NULL,
  customer_id      uuid,
  coupon_id        uuid,
  channel          text NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram', 'web', 'manual', 'api')),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'paid', 'fulfilled', 'cancelled', 'refunded')),
  currency         char(3) NOT NULL,
  subtotal_minor   bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor   bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  total_minor      bigint NOT NULL CHECK (total_minor >= 0),
  customer_note    text NOT NULL DEFAULT '' CHECK (length(customer_note) <= 1000),
  idempotency_key  text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, number),
  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (workspace_id, id),
  CHECK (total_minor = subtotal_minor - discount_minor),
  FOREIGN KEY (workspace_id, customer_id) REFERENCES customers(workspace_id, id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (workspace_id, coupon_id) REFERENCES coupons(workspace_id, id) ON DELETE SET NULL (coupon_id)
);
CREATE INDEX orders_ws_created_idx ON orders(workspace_id, created_at DESC);
CREATE INDEX orders_ws_status_idx ON orders(workspace_id, status);
CREATE TRIGGER orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL,
  order_id         uuid NOT NULL,
  variant_id       uuid,
  product_name     text NOT NULL,  -- snapshot at purchase time
  variant_name     text NOT NULL,
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  quantity         integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  line_total_minor bigint NOT NULL CHECK (line_total_minor = unit_price_minor * quantity),
  FOREIGN KEY (workspace_id, order_id) REFERENCES orders(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, variant_id) REFERENCES product_variants(workspace_id, id) ON DELETE SET NULL (variant_id)
);
CREATE INDEX order_items_order_idx ON order_items(workspace_id, order_id);

CREATE TABLE order_status_history (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  order_id     uuid NOT NULL,
  from_status  text,
  to_status    text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, order_id) REFERENCES orders(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX order_status_history_idx ON order_status_history(workspace_id, order_id);

-- ───────────────────────────── Billing & payments ────────────────────────────
-- Invoices cover both platform subscriptions (purpose=subscription) and merchant orders (purpose=order).

CREATE TABLE invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  purpose       text NOT NULL CHECK (purpose IN ('subscription', 'order')),
  plan_code     text REFERENCES plans(code),
  order_id      uuid,
  payer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  provider      text NOT NULL CHECK (provider IN ('telegram_stars', 'manual_transfer')),
  currency      text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void', 'refunded')),
  payload_nonce text NOT NULL UNIQUE,  -- sent as Telegram invoice payload; maps callbacks to the invoice
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  paid_at       timestamptz,
  FOREIGN KEY (workspace_id, order_id) REFERENCES orders(workspace_id, id) ON DELETE SET NULL (order_id),
  CHECK ((purpose = 'subscription' AND plan_code IS NOT NULL) OR purpose = 'order')
);
CREATE INDEX invoices_ws_idx ON invoices(workspace_id, created_at DESC);

CREATE TABLE payment_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  stage        text NOT NULL CHECK (stage IN ('invoice_sent', 'pre_checkout_ok', 'pre_checkout_rejected', 'failed')),
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_attempts_invoice_idx ON payment_attempts(invoice_id);

CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id         uuid NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE RESTRICT,
  provider           text NOT NULL,
  provider_charge_id text NOT NULL,
  currency           text NOT NULL,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  status             text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded', 'refunded', 'partially_refunded')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_charge_id) -- idempotency: a charge is recorded at most once
);

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payment_id         uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  status             text NOT NULL CHECK (status IN ('requested', 'succeeded', 'failed')),
  reason             text NOT NULL DEFAULT '',
  actor_user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Inbound provider events, deduplicated (replay protection).
CREATE TABLE webhook_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider     text NOT NULL,
  event_id     text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, event_id)
);

-- ───────────────────────────── AI ────────────────────────────────────────────

CREATE TABLE faq_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question     text NOT NULL CHECK (length(question) BETWEEN 1 AND 500),
  answer       text NOT NULL CHECK (length(answer) BETWEEN 1 AND 2000),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX faq_ws_idx ON faq_entries(workspace_id);

CREATE TABLE ai_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  feature       text NOT NULL CHECK (feature IN ('reply_suggestion', 'product_description', 'faq_answer')),
  mode          text NOT NULL,
  provider      text NOT NULL,
  model         text NOT NULL,
  input_chars   integer NOT NULL DEFAULT 0,
  output_text   text,
  status        text NOT NULL CHECK (status IN ('succeeded', 'failed', 'refused', 'quota_exceeded')),
  review_status text NOT NULL DEFAULT 'none' CHECK (review_status IN ('none', 'pending', 'approved', 'rejected')),
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_requests_ws_idx ON ai_requests(workspace_id, created_at DESC);

-- ───────────────────────────── CRM / consent foundation ──────────────────────

CREATE TABLE consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL,
  channel      text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('transactional', 'marketing')),
  status       text NOT NULL CHECK (status IN ('opted_in', 'opted_out')),
  source       text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, customer_id, channel, purpose),
  FOREIGN KEY (workspace_id, customer_id) REFERENCES customers(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE connected_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform       text NOT NULL,
  status         text NOT NULL CHECK (status IN ('pending', 'connected', 'error', 'disconnected')),
  display_name   text NOT NULL DEFAULT '',
  external_id    text,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform, external_id)
);

-- ───────────────────────────── Platform (global) ─────────────────────────────

CREATE TABLE audit_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_ws_idx ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);

CREATE TABLE analytics_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL CHECK (name ~ '^[a-z_]{2,48}$'),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  props        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_name_idx ON analytics_events(name, created_at DESC);

CREATE TABLE feature_flags (
  key                text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]{2,64}$'),
  enabled            boolean NOT NULL DEFAULT false,
  rollout_percent    integer NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  allow_workspaces   uuid[] NOT NULL DEFAULT '{}',
  description        text NOT NULL DEFAULT '',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  run_at       timestamptz NOT NULL DEFAULT now(),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error   text,
  locked_at    timestamptz,
  dedupe_key   text UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX jobs_ready_idx ON jobs(run_at) WHERE status = 'queued';

CREATE TABLE support_tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference    text NOT NULL UNIQUE CHECK (reference ~ '^MLR-[A-Z0-9]{6}$'),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  category     text NOT NULL CHECK (category IN ('technical', 'payment', 'account', 'other')),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  subject      text NOT NULL CHECK (length(subject) BETWEEN 1 AND 160),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_user_idx ON support_tickets(user_id, created_at DESC);
CREATE TRIGGER support_tickets_updated BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE support_messages (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id    uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  is_staff     boolean NOT NULL DEFAULT false,
  body         text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_ticket_idx ON support_messages(ticket_id, id);

CREATE TABLE account_deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  execute_after timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE TABLE backup_runs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('backup', 'restore_test')),
  status       text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  detail       text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────── Row-level security ────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'subscriptions', 'usage_counters', 'categories', 'products', 'product_variants',
    'customers', 'coupons', 'orders', 'order_items', 'order_status_history',
    'invoices', 'payment_attempts', 'payments', 'refunds', 'faq_entries', 'ai_requests',
    'consents', 'connected_accounts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO millerenos_app
         USING (workspace_id = app_current_workspace())
         WITH CHECK (workspace_id = app_current_workspace())', t);
    EXECUTE format('CREATE POLICY system_all ON %I TO millerenos_system USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- workspaces: the tenant sees only its own row.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspaces TO millerenos_app
  USING (id = app_current_workspace()) WITH CHECK (id = app_current_workspace());
CREATE POLICY system_all ON workspaces TO millerenos_system USING (true) WITH CHECK (true);

-- ───────────────────────────── Grants ────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO millerenos_app, millerenos_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO millerenos_app, millerenos_system;
-- The tenant role never touches platform-only tables directly.
REVOKE ALL ON jobs, feature_flags, backup_runs, account_deletion_requests, webhook_events FROM millerenos_app;
GRANT SELECT ON feature_flags TO millerenos_app;
-- Audit and analytics are append-only for the tenant role.
REVOKE UPDATE, DELETE ON audit_logs, analytics_events FROM millerenos_app;

-- ───────────────────────────── Seed data ─────────────────────────────────────

INSERT INTO plans (code, price_stars, period_days, limits, sort) VALUES
  ('starter', 250, 30, '{"products": 100, "ai_requests_per_day": 50, "staff": 1}', 10),
  ('growth',  750, 30, '{"products": 2000, "ai_requests_per_day": 300, "staff": 5}', 20);

INSERT INTO feature_flags (key, enabled, description) VALUES
  ('ai.assistant', true, 'AI assistant (requires provider credentials)'),
  ('payments.telegram_stars', true, 'Telegram Stars subscription checkout'),
  ('store.public', true, 'Public Telegram storefront via Mini App'),
  ('channels.bale', false, 'Bale connector (not implemented)'),
  ('channels.whatsapp', false, 'WhatsApp Business connector (not implemented)'),
  ('domains.marketplace', false, 'Domain marketplace (no provider configured)');
