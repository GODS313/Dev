<?php
declare(strict_types=1);

namespace Mlr;

/** Business logic for the shared-hosting edition. Mirrors apps/server/src/modules (Node edition). */
final class App
{
    public const EVENTS = ['bot_started', 'language_selected', 'trial_started', 'trial_activated', 'trial_expired', 'miniapp_opened',
        'store_created', 'store_published', 'product_created', 'first_order', 'order_created', 'checkout_started', 'payment_completed',
        'subscription_started', 'subscription_renewed', 'referral_created', 'referral_signup', 'support_ticket_created'];

    public function __construct(public Db $db, public Config $cfg, public TelegramApi $tg)
    {
    }

    // ── analytics / audit / rate limit ───────────────────────────────────────
    public function track(string $name, ?string $userId = null, ?string $wid = null, array $props = []): void
    {
        if (!in_array($name, self::EVENTS, true)) throw new \LogicException("unknown event {$name}");
        $clean = [];
        foreach (array_slice($props, 0, 12, true) as $k => $v) {
            if (!preg_match('/^[a-z_]{1,32}$/', (string) $k)) continue;
            if (is_bool($v) || is_int($v) || $v === null) $clean[$k] = $v;
            elseif (is_string($v)) $clean[$k] = mb_substr($v, 0, 64);
        }
        $this->db->exec('INSERT INTO analytics_events (name, user_id, workspace_id, props, created_at) VALUES (?, ?, ?, ?, ?)',
            [$name, $userId, $wid, json_encode($clean), now()]);
    }

    public function audit(string $action, ?string $actor = null, ?string $wid = null, ?string $type = null, ?string $target = null, array $meta = []): void
    {
        $this->db->exec('INSERT INTO audit_logs (workspace_id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$wid, $actor, $action, $type, $target, json_encode($meta, JSON_UNESCAPED_UNICODE), now()]);
    }

    /** Fixed-window limiter persisted in SQLite (works across PHP processes). */
    public function rateLimit(string $key, int $max, int $window): void
    {
        $w = intdiv(now(), $window);
        $this->db->exec('INSERT INTO rate_limits (key, win, hits) VALUES (?, ?, 1) ON CONFLICT(key, win) DO UPDATE SET hits = hits + 1', [$key, $w]);
        $hits = (int) $this->db->one('SELECT hits FROM rate_limits WHERE key = ? AND win = ?', [$key, $w])['hits'];
        if ($hits > $max) throw new AppError('rate_limited', 'Too many requests', ['retryAfterSeconds' => $window - now() % $window]);
    }

    // ── identity ────────────────────────────────────────────────────────────
    public function upsertUser(array $tg): array
    {
        $id = (int) $tg['id'];
        $isAdmin = in_array((string) $id, $this->cfg->adminIds, true);
        $existing = $this->db->one('SELECT * FROM users WHERE telegram_user_id = ?', [$id]);
        $first = mb_substr((string) ($tg['first_name'] ?? ''), 0, 128);
        $username = isset($tg['username']) ? mb_substr((string) $tg['username'], 0, 64) : null;
        if ($existing) {
            $this->db->exec('UPDATE users SET first_name = ?, username = ?, platform_role = CASE WHEN ? THEN \'superadmin\' ELSE platform_role END WHERE id = ?',
                [$first, $username, $isAdmin ? 1 : 0, $existing['id']]);
            return [$this->user($existing['id']), false];
        }
        $uid = uuid();
        $locale = str_starts_with(strtolower((string) ($tg['language_code'] ?? '')), 'fa') ? 'fa' : 'en';
        $this->db->exec('INSERT OR IGNORE INTO users (id, telegram_user_id, first_name, username, locale, platform_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$uid, $id, $first, $username, $locale, $isAdmin ? 'superadmin' : 'user', now()]);
        $row = $this->db->one('SELECT id FROM users WHERE telegram_user_id = ?', [$id]);
        return [$this->user($row['id']), $row['id'] === $uid];
    }

    public function user(string $id): ?array
    {
        return $this->db->one('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [$id]);
    }

    public static function publicUser(array $u): array
    {
        return ['id' => $u['id'], 'firstName' => $u['first_name'], 'username' => $u['username'], 'locale' => $u['locale'], 'platformRole' => $u['platform_role']];
    }

    public function createSession(string $userId): array
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $exp = now() + $this->cfg->sessionHours * 3600;
        $this->db->exec('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [hash('sha256', $token), $userId, $exp]);
        return ['token' => $token, 'expiresAt' => iso($exp)];
    }

    public function resolveSession(string $token): ?array
    {
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $token)) return null;
        return $this->db->one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.deleted_at IS NULL', [hash('sha256', $token), now()]);
    }

    public function revokeSession(string $token): void
    {
        $this->db->exec('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', [now(), hash('sha256', $token)]);
    }

    // ── workspaces ──────────────────────────────────────────────────────────
    public function listUserWorkspaces(string $userId): array
    {
        return $this->db->all("SELECT w.id, w.name, w.slug, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
            WHERE m.user_id = ? AND w.status <> 'deleted' ORDER BY m.created_at", [$userId]);
    }

    /** Non-members get 404 (no existence leak); insufficient role gets 403. */
    public function requireRole(string $wid, string $userId, string $min): string
    {
        if (!isUuid($wid)) throw new AppError('validation_failed', 'Invalid workspace id');
        $m = $this->db->one('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', [$wid, $userId]);
        if (!$m) throw new AppError('not_found', 'Workspace not found');
        $rank = ['staff' => 1, 'admin' => 2, 'owner' => 3];
        if ($rank[$m['role']] < $rank[$min]) throw new AppError('forbidden', 'Insufficient role');
        return $m['role'];
    }

    public function workspace(string $wid): array
    {
        $w = $this->db->one('SELECT * FROM workspaces WHERE id = ?', [$wid]);
        if (!$w) throw new AppError('not_found', 'Workspace not found');
        return [
            'id' => $w['id'], 'name' => $w['name'], 'slug' => $w['slug'], 'owner_user_id' => $w['owner_user_id'],
            'default_locale' => $w['default_locale'], 'currency' => $w['currency'], 'status' => $w['status'],
            'store_published' => (bool) $w['store_published'], 'store_settings' => json_decode($w['store_settings'], true) ?: new \stdClass(),
            'ai_mode' => $w['ai_mode'], 'business_policies' => $w['business_policies'], 'created_at' => iso((int) $w['created_at']),
        ];
    }

    public static function slugify(string $name): string
    {
        $s = strtolower((string) preg_replace('/[^A-Za-z0-9]+/', '-', (string) iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $name)));
        $s = substr(trim($s, '-'), 0, 24);
        return (strlen($s) >= 3 ? $s : 'store') . '-' . randomCode(5, 'abcdefghijkmnpqrstuvwxyz23456789');
    }

    public function startTrial(array $user, ?string $businessName = null): array
    {
        if ($user['is_blocked']) throw new AppError('forbidden', 'Account is blocked');
        if (!$user['telegram_user_id']) throw new AppError('forbidden', 'A Telegram account is required for the free trial');
        $subject = hash_hmac('sha256', 'tg:' . $user['telegram_user_id'], $this->cfg->dataSecret);
        return $this->db->tx(function (Db $db) use ($user, $businessName, $subject) {
            if ($db->one('SELECT 1 FROM trials WHERE user_id = ?', [$user['id']]) || $db->one('SELECT 1 FROM trial_claims WHERE subject_hash = ?', [$subject])) {
                return ['started' => false];
            }
            if ((int) $db->one('SELECT count(*) n FROM trials WHERE started_at > ?', [now() - 3600])['n'] >= 500) {
                throw new AppError('rate_limited', 'Trials are temporarily busy. Please try again shortly.');
            }
            $name = trim((string) $businessName) ?: ($user['locale'] === 'fa' ? 'کسب‌وکار من' : trim(($user['first_name'] ?: 'My') . ' Business'));
            $wid = uuid();
            $db->exec('INSERT INTO workspaces (id, name, slug, owner_user_id, default_locale, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [$wid, mb_substr($name, 0, 80), self::slugify($name), $user['id'], $user['locale'], now()]);
            $db->exec("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", [$wid, $user['id'], now()]);
            $exp = now() + $this->cfg->trialMinutes * 60;
            $db->exec('INSERT INTO trials (id, user_id, workspace_id, started_at, expires_at) VALUES (?, ?, ?, ?, ?)', [uuid(), $user['id'], $wid, now(), $exp]);
            $db->exec('INSERT INTO trial_claims (subject_hash, claimed_at) VALUES (?, ?)', [$subject, now()]);
            $this->track('trial_started', $user['id'], $wid);
            $this->track('store_created', $user['id'], $wid, ['source' => 'trial']);
            return ['started' => true, 'workspace' => $this->workspace($wid), 'expiresAt' => iso($exp)];
        });
    }

    public function access(string $wid): array
    {
        $sub = $this->db->one("SELECT s.plan_code, s.current_period_end, p.limits FROM subscriptions s JOIN plans p ON p.code = s.plan_code
            WHERE s.workspace_id = ? AND s.status = 'active' AND s.current_period_end > ? ORDER BY s.current_period_end DESC LIMIT 1", [$wid, now()]);
        if ($sub) {
            $l = json_decode($sub['limits'], true);
            return ['state' => 'subscribed', 'plan' => $sub['plan_code'], 'periodEnd' => iso((int) $sub['current_period_end']),
                'limits' => ['products' => $l['products'] ?? 100, 'orders' => null, 'ai_requests' => $l['ai_requests_per_day'] ?? 0, 'ai_window' => 'day']];
        }
        $t = $this->db->one('SELECT expires_at FROM trials WHERE workspace_id = ?', [$wid]);
        if ($t && (int) $t['expires_at'] > now()) {
            return ['state' => 'trial', 'trialEndsAt' => iso((int) $t['expires_at']), 'secondsLeft' => (int) $t['expires_at'] - now(),
                'limits' => ['products' => $this->cfg->trialProducts, 'orders' => $this->cfg->trialOrders, 'ai_requests' => 0, 'ai_window' => 'trial']];
        }
        return ['state' => 'expired', 'trialEndedAt' => $t ? iso((int) $t['expires_at']) : null,
            'limits' => ['products' => 0, 'orders' => 0, 'ai_requests' => 0, 'ai_window' => 'day']];
    }

    public static function requireWrite(array $access): void
    {
        if ($access['state'] === 'expired') throw new AppError('access_expired', 'Your trial has ended. Choose a plan to continue — your data is kept.');
    }

    public function onboarding(string $wid): array
    {
        $steps = [
            ['key' => 'business_created', 'done' => true],
            ['key' => 'product_added', 'done' => (bool) $this->db->one("SELECT 1 FROM products WHERE workspace_id = ? AND status = 'active'", [$wid])],
            ['key' => 'store_published', 'done' => (bool) $this->db->one('SELECT 1 FROM workspaces WHERE id = ? AND store_published = 1', [$wid])],
            ['key' => 'first_order', 'done' => (bool) $this->db->one('SELECT 1 FROM orders WHERE workspace_id = ?', [$wid])],
        ];
        return ['steps' => $steps, 'completed' => count(array_filter($steps, fn($s) => $s['done'])), 'total' => 4];
    }

    public function countProducts(string $wid): int
    {
        return (int) $this->db->one("SELECT count(*) n FROM products WHERE workspace_id = ? AND status <> 'archived'", [$wid])['n'];
    }

    public function countOrders(string $wid): int
    {
        return (int) $this->db->one('SELECT count(*) n FROM orders WHERE workspace_id = ?', [$wid])['n'];
    }

    public function storeLink(string $slug): ?string
    {
        return $this->cfg->botUsername ? "https://t.me/{$this->cfg->botUsername}?start=store_{$slug}" : null;
    }

    // ── catalog ─────────────────────────────────────────────────────────────
    private function hydrateProducts(string $wid, array $rows): array
    {
        if (!$rows) return [];
        $ids = array_column($rows, 'id');
        $in = implode(',', array_fill(0, count($ids), '?'));
        $vs = $this->db->all("SELECT * FROM product_variants WHERE workspace_id = ? AND product_id IN ($in) ORDER BY created_at", array_merge([$wid], $ids));
        $by = [];
        foreach ($vs as $v) {
            $by[$v['product_id']][] = ['id' => $v['id'], 'name' => $v['name'], 'sku' => $v['sku'], 'price_minor' => (string) $v['price_minor'],
                'stock' => $v['stock'] === null ? null : (int) $v['stock'], 'is_active' => (bool) $v['is_active']];
        }
        return array_map(fn($p) => ['id' => $p['id'], 'name' => $p['name'], 'description' => $p['description'], 'kind' => $p['kind'],
            'status' => $p['status'], 'created_at' => iso((int) $p['created_at']), 'variants' => $by[$p['id']] ?? []], $rows);
    }

    public function listProducts(string $wid, ?string $status = null): array
    {
        $rows = $this->db->all('SELECT * FROM products WHERE workspace_id = ? AND (? IS NULL OR status = ?) ORDER BY created_at DESC, id LIMIT 200', [$wid, $status, $status]);
        return $this->hydrateProducts($wid, $rows);
    }

    public function product(string $wid, string $pid): array
    {
        $rows = $this->db->all('SELECT * FROM products WHERE workspace_id = ? AND id = ?', [$wid, $pid]);
        if (!$rows) throw new AppError('not_found', 'Product not found');
        return $this->hydrateProducts($wid, $rows)[0];
    }

    public function createProduct(string $wid, array $in): array
    {
        $pid = uuid();
        $this->db->exec('INSERT INTO products (id, workspace_id, kind, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$pid, $wid, $in['kind'] ?? 'physical', $in['name'], $in['description'] ?? '', $in['status'] ?? 'active', now(), now()]);
        $this->db->exec("INSERT INTO product_variants (id, workspace_id, product_id, name, sku, price_minor, stock, created_at) VALUES (?, ?, ?, 'Default', ?, ?, ?, ?)",
            [uuid(), $wid, $pid, $in['sku'] ?? null, $in['priceMinor'], $in['stock'] ?? null, now()]);
        return $this->product($wid, $pid);
    }

    public function updateProduct(string $wid, string $pid, array $in): array
    {
        $this->product($wid, $pid);
        $sets = [];
        $vals = [];
        foreach (['name', 'description', 'kind', 'status'] as $k) {
            if (array_key_exists($k, $in)) { $sets[] = "$k = ?"; $vals[] = $in[$k]; }
        }
        if ($sets) $this->db->exec('UPDATE products SET ' . implode(', ', $sets) . ', updated_at = ? WHERE workspace_id = ? AND id = ?', array_merge($vals, [now(), $wid, $pid]));
        $vs = [];
        $vv = [];
        if (array_key_exists('priceMinor', $in)) { $vs[] = 'price_minor = ?'; $vv[] = $in['priceMinor']; }
        if (array_key_exists('stock', $in)) { $vs[] = 'stock = ?'; $vv[] = $in['stock']; }
        if (array_key_exists('sku', $in)) { $vs[] = 'sku = ?'; $vv[] = $in['sku']; }
        if ($vs) $this->db->exec('UPDATE product_variants SET ' . implode(', ', $vs) . ' WHERE workspace_id = ? AND product_id = ?', array_merge($vv, [$wid, $pid]));
        return $this->product($wid, $pid);
    }

    // ── orders ──────────────────────────────────────────────────────────────
    public const TRANSITIONS = ['pending' => ['confirmed', 'paid', 'cancelled'], 'confirmed' => ['paid', 'fulfilled', 'cancelled'],
        'paid' => ['fulfilled', 'refunded'], 'fulfilled' => ['refunded'], 'cancelled' => [], 'refunded' => []];

    /** Server-side pricing, stock checks and idempotency, inside one IMMEDIATE transaction. */
    public function createOrder(string $wid, array $items, ?string $customerId, string $note, string $channel, string $idem): array
    {
        return $this->db->tx(function (Db $db) use ($wid, $items, $customerId, $note, $channel, $idem) {
            if ($ex = $db->one('SELECT id FROM orders WHERE workspace_id = ? AND idempotency_key = ?', [$wid, $idem])) {
                return ['order' => $this->order($wid, $ex['id']), 'created' => false];
            }
            if (!$items || count($items) > 50) throw new AppError('validation_failed', 'Order must have 1-50 items');
            $merged = [];
            foreach ($items as $it) $merged[$it['variantId']] = ($merged[$it['variantId']] ?? 0) + (int) $it['quantity'];
            $ws = $db->one('SELECT currency FROM workspaces WHERE id = ?', [$wid]);
            $in = implode(',', array_fill(0, count($merged), '?'));
            $vs = $db->all("SELECT v.id, v.name, v.price_minor, v.stock, p.name AS product_name FROM product_variants v JOIN products p ON p.id = v.product_id AND p.workspace_id = v.workspace_id
                WHERE v.workspace_id = ? AND v.id IN ($in) AND v.is_active = 1 AND p.status = 'active'", array_merge([$wid], array_keys($merged)));
            if (count($vs) !== count($merged)) throw new AppError('validation_failed', 'One or more items are unavailable');
            $subtotal = 0;
            foreach ($vs as &$v) {
                $v['qty'] = $merged[$v['id']];
                if ($v['qty'] < 1 || $v['qty'] > 999) throw new AppError('validation_failed', 'Invalid quantity');
                if ($v['stock'] !== null && (int) $v['stock'] < $v['qty']) throw new AppError('conflict', "Not enough stock for {$v['product_name']}");
                $subtotal += (int) $v['price_minor'] * $v['qty'];
            }
            unset($v);
            $db->exec('UPDATE workspaces SET order_seq = order_seq + 1 WHERE id = ?', [$wid]);
            $num = (int) $db->one('SELECT order_seq FROM workspaces WHERE id = ?', [$wid])['order_seq'];
            $oid = uuid();
            $db->exec('INSERT INTO orders (id, workspace_id, number, customer_id, channel, currency, subtotal_minor, discount_minor, total_minor, customer_note, idempotency_key, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)', [$oid, $wid, $num, $customerId, $channel, $ws['currency'], $subtotal, $subtotal, mb_substr($note, 0, 1000), $idem, now(), now()]);
            foreach ($vs as $v) {
                $db->exec('INSERT INTO order_items (id, workspace_id, order_id, variant_id, product_name, variant_name, unit_price_minor, quantity, line_total_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [uuid(), $wid, $oid, $v['id'], $v['product_name'], $v['name'], (int) $v['price_minor'], $v['qty'], (int) $v['price_minor'] * $v['qty']]);
                if ($v['stock'] !== null) $db->exec('UPDATE product_variants SET stock = stock - ? WHERE workspace_id = ? AND id = ?', [$v['qty'], $wid, $v['id']]);
            }
            $db->exec("INSERT INTO order_status_history (workspace_id, order_id, to_status, created_at) VALUES (?, ?, 'pending', ?)", [$wid, $oid, now()]);
            return ['order' => $this->order($wid, $oid), 'created' => true];
        });
    }

    public function order(string $wid, string $oid): array
    {
        $o = $this->db->one('SELECT o.*, c.display_name AS customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id AND c.workspace_id = o.workspace_id
            WHERE o.workspace_id = ? AND o.id = ?', [$wid, $oid]);
        if (!$o) throw new AppError('not_found', 'Order not found');
        $items = array_map(fn($i) => ['product_name' => $i['product_name'], 'variant_name' => $i['variant_name'], 'unit_price_minor' => (string) $i['unit_price_minor'],
            'quantity' => (int) $i['quantity'], 'line_total_minor' => (string) $i['line_total_minor']],
            $this->db->all('SELECT * FROM order_items WHERE workspace_id = ? AND order_id = ?', [$wid, $oid]));
        return ['id' => $o['id'], 'number' => (string) $o['number'], 'status' => $o['status'], 'channel' => $o['channel'], 'currency' => $o['currency'],
            'subtotal_minor' => (string) $o['subtotal_minor'], 'discount_minor' => (string) $o['discount_minor'], 'total_minor' => (string) $o['total_minor'],
            'customer_note' => $o['customer_note'], 'created_at' => iso((int) $o['created_at']), 'customer_id' => $o['customer_id'],
            'customer_name' => $o['customer_name'], 'items' => $items];
    }

    public function listOrders(string $wid, ?string $status): array
    {
        return array_map(fn($o) => ['id' => $o['id'], 'number' => (string) $o['number'], 'status' => $o['status'], 'channel' => $o['channel'],
            'currency' => $o['currency'], 'total_minor' => (string) $o['total_minor'], 'created_at' => iso((int) $o['created_at']), 'customer_name' => $o['customer_name']],
            $this->db->all('SELECT o.*, c.display_name AS customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id AND c.workspace_id = o.workspace_id
                WHERE o.workspace_id = ? AND (? IS NULL OR o.status = ?) ORDER BY o.created_at DESC, o.number DESC LIMIT 200', [$wid, $status, $status]));
    }

    public function transitionOrder(string $wid, string $oid, string $to, string $actor): array
    {
        return $this->db->tx(function (Db $db) use ($wid, $oid, $to, $actor) {
            $cur = $db->one('SELECT status FROM orders WHERE workspace_id = ? AND id = ?', [$wid, $oid]);
            if (!$cur) throw new AppError('not_found', 'Order not found');
            if (!in_array($to, self::TRANSITIONS[$cur['status']], true)) throw new AppError('conflict', "Cannot change order from {$cur['status']} to {$to}");
            $db->exec('UPDATE orders SET status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?', [$to, now(), $wid, $oid]);
            if ($to === 'cancelled') {
                foreach ($db->all('SELECT variant_id, quantity FROM order_items WHERE workspace_id = ? AND order_id = ?', [$wid, $oid]) as $i) {
                    $db->exec('UPDATE product_variants SET stock = stock + ? WHERE workspace_id = ? AND id = ? AND stock IS NOT NULL', [$i['quantity'], $wid, $i['variant_id']]);
                }
            }
            $db->exec('INSERT INTO order_status_history (workspace_id, order_id, from_status, to_status, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [$wid, $oid, $cur['status'], $to, $actor, now()]);
            $this->audit('order.status_changed', $actor, $wid, 'order', $oid, ['to' => $to]);
            return $this->order($wid, $oid);
        });
    }

    // ── billing (Telegram Stars) ────────────────────────────────────────────
    public function plans(): array
    {
        return array_map(fn($p) => ['code' => $p['code'], 'price_stars' => (int) $p['price_stars'], 'period_days' => (int) $p['period_days'],
            'limits' => json_decode($p['limits'], true), 'price_usdt_micro' => $p['price_usdt_micro'] === null ? null : (string) $p['price_usdt_micro'],
            'price_trx_sun' => $p['price_trx_sun'] === null ? null : (string) $p['price_trx_sun']],
            $this->db->all('SELECT * FROM plans WHERE is_active = 1 ORDER BY sort'));
    }

    public function createCheckout(string $wid, array $user, string $planCode): array
    {
        if (!$this->cfg->botToken) throw new AppError('not_configured', 'Payments are not configured yet');
        $plan = null;
        foreach ($this->plans() as $p) if ($p['code'] === $planCode) $plan = $p;
        if (!$plan) throw new AppError('not_found', 'Plan not found');
        $nonce = 'sub_' . rtrim(strtr(base64_encode(random_bytes(18)), '+/', '-_'), '=');
        $iid = uuid();
        $this->db->exec("INSERT INTO invoices (id, workspace_id, purpose, plan_code, payer_user_id, provider, currency, amount_minor, payload_nonce, expires_at, created_at)
            VALUES (?, ?, 'subscription', ?, ?, 'telegram_stars', 'XTR', ?, ?, ?, ?)", [$iid, $wid, $plan['code'], $user['id'], $plan['price_stars'], $nonce, now() + 3600, now()]);
        $this->track('checkout_started', $user['id'], $wid, ['plan' => $plan['code']]);
        $fa = $user['locale'] === 'fa';
        $title = $fa ? "اشتراک Millerenos — {$plan['code']}" : "Millerenos {$plan['code']} plan";
        $link = $this->tg->call('createInvoiceLink', [
            'title' => mb_substr($title, 0, 32), 'description' => $fa ? "دسترسی {$plan['period_days']} روزه به Millerenos" : "{$plan['period_days']}-day access to Millerenos",
            'payload' => $nonce, 'provider_token' => '', 'currency' => 'XTR', 'prices' => [['label' => mb_substr($title, 0, 32), 'amount' => $plan['price_stars']]],
        ]);
        return ['invoiceId' => $iid, 'link' => $link];
    }

    private function invoiceByPayload(string $payload): ?array
    {
        if (!preg_match('/^sub_[A-Za-z0-9_-]{24}$/', $payload)) return null;
        return $this->db->one('SELECT i.*, u.telegram_user_id AS payer_tg FROM invoices i LEFT JOIN users u ON u.id = i.payer_user_id WHERE i.payload_nonce = ?', [$payload]);
    }

    /** Re-validates the invoice before Telegram charges the user. Returns null when OK, else a reason. */
    public function preCheckout(string $payload, string $currency, int $amount, int $fromId): ?string
    {
        $inv = $this->invoiceByPayload($payload);
        if (!$inv) return 'unknown_invoice';
        if ($inv['status'] !== 'open') return 'invoice_not_open';
        if ((int) $inv['expires_at'] <= now()) return 'invoice_expired';
        if ($inv['currency'] !== $currency || (int) $inv['amount_minor'] !== $amount) return 'amount_mismatch';
        if ((int) $inv['payer_tg'] !== $fromId) return 'payer_mismatch';
        return null;
    }

    /** Exactly-once: webhook_events + unique charge id. Mismatches are recorded and flagged, never applied. */
    public function successfulPayment(string $payload, string $currency, int $amount, string $chargeId): array
    {
        return $this->db->tx(function (Db $db) use ($payload, $currency, $amount, $chargeId) {
            if ($db->one("SELECT 1 FROM webhook_events WHERE provider = 'telegram_stars' AND event_id = ?", [$chargeId])) return ['kind' => 'duplicate'];
            $db->exec("INSERT INTO webhook_events (provider, event_id, received_at) VALUES ('telegram_stars', ?, ?)", [$chargeId, now()]);
            $inv = $this->invoiceByPayload($payload);
            if (!$inv) {
                $this->audit('payment.orphan', null, null, null, null, ['chargeId' => $chargeId, 'amount' => $amount]);
                return ['kind' => 'needs_review', 'reason' => 'unknown_invoice'];
            }
            $db->exec('INSERT INTO payments (id, workspace_id, invoice_id, provider, provider_charge_id, currency, amount_minor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [uuid(), $inv['workspace_id'], $inv['id'], 'telegram_stars', $chargeId, $currency, $amount, now()]);
            $mismatch = $inv['status'] !== 'open' ? 'invoice_not_open' : (($inv['currency'] !== $currency || (int) $inv['amount_minor'] !== $amount) ? 'amount_mismatch' : null);
            if ($mismatch || !$inv['plan_code']) {
                $this->audit('payment.needs_review', null, $inv['workspace_id'], 'invoice', $inv['id'], ['reason' => $mismatch ?? 'unsupported']);
                return ['kind' => 'needs_review', 'reason' => $mismatch ?? 'unsupported'];
            }
            $db->exec("UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?", [now(), $inv['id']]);
            $days = (int) $db->one('SELECT period_days FROM plans WHERE code = ?', [$inv['plan_code']])['period_days'];
            $db->exec("UPDATE subscriptions SET status = 'expired' WHERE workspace_id = ? AND status = 'active' AND current_period_end <= ?", [$inv['workspace_id'], now()]);
            $cur = $db->one("SELECT id, current_period_end FROM subscriptions WHERE workspace_id = ? AND status = 'active'", [$inv['workspace_id']]);
            if ($cur) {
                $end = (int) $cur['current_period_end'] + $days * 86400;
                $db->exec('UPDATE subscriptions SET plan_code = ?, current_period_end = ? WHERE id = ?', [$inv['plan_code'], $end, $cur['id']]);
            } else {
                $end = now() + $days * 86400;
                $db->exec("INSERT INTO subscriptions (id, workspace_id, plan_code, status, current_period_start, current_period_end, created_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
                    [uuid(), $inv['workspace_id'], $inv['plan_code'], now(), $end, now()]);
            }
            $db->exec("UPDATE trials SET status = 'converted', converted_at = ? WHERE workspace_id = ?", [now(), $inv['workspace_id']]);
            $this->track('payment_completed', null, $inv['workspace_id'], ['plan' => $inv['plan_code']]);
            $this->track($cur ? 'subscription_renewed' : 'subscription_started', null, $inv['workspace_id'], ['plan' => $inv['plan_code']]);
            return ['kind' => 'activated', 'workspaceId' => $inv['workspace_id'], 'plan' => $inv['plan_code'], 'periodEnd' => $end];
        });
    }

    // ── public store ────────────────────────────────────────────────────────
    public function publicStore(string $slug): array
    {
        if (!preg_match('/^[a-z0-9][a-z0-9-]{2,39}$/', $slug)) throw new AppError('not_found', 'Store not found');
        $w = $this->db->one("SELECT * FROM workspaces WHERE slug = ? AND status = 'active' AND store_published = 1", [$slug]);
        if (!$w) throw new AppError('not_found', 'Store not found');
        if ($this->access($w['id'])['state'] === 'expired') throw new AppError('not_found', 'Store is temporarily unavailable');
        $s = json_decode($w['store_settings'], true) ?: [];
        return ['id' => $w['id'], 'store' => ['name' => $w['name'], 'slug' => $w['slug'], 'currency' => $w['currency'], 'locale' => $w['default_locale'],
            'tagline' => (string) ($s['tagline'] ?? ''), 'supportContact' => (string) ($s['support_contact'] ?? ''), 'deliveryInfo' => (string) ($s['delivery_info'] ?? '')]];
    }

    public function publicCatalog(string $wid): array
    {
        $out = [];
        foreach ($this->listProducts($wid, 'active') as $p) {
            $vs = array_values(array_filter($p['variants'], fn($v) => $v['is_active']));
            if (!$vs) continue;
            $out[] = ['id' => $p['id'], 'name' => $p['name'], 'description' => $p['description'], 'kind' => $p['kind'],
                'variants' => array_map(fn($v) => ['id' => $v['id'], 'name' => $v['name'], 'price_minor' => $v['price_minor'], 'in_stock' => $v['stock'] === null || $v['stock'] > 0], $vs)];
        }
        return $out;
    }

    public function upsertCustomer(string $wid, int $tgId, string $name): string
    {
        $this->db->exec('INSERT INTO customers (id, workspace_id, display_name, telegram_user_id, created_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, telegram_user_id) DO UPDATE SET display_name = excluded.display_name', [uuid(), $wid, mb_substr($name, 0, 128), $tgId, now()]);
        return $this->db->one('SELECT id FROM customers WHERE workspace_id = ? AND telegram_user_id = ?', [$wid, $tgId])['id'];
    }

    // ── notifications ───────────────────────────────────────────────────────
    public function notify(?int $chatId, string $text, ?string $appPage = null, string $locale = 'en'): void
    {
        if (!$chatId || !$this->cfg->botToken) return;
        $params = ['chat_id' => $chatId, 'text' => $text, 'parse_mode' => 'HTML', 'link_preview_options' => ['is_disabled' => true]];
        if ($appPage) {
            $params['reply_markup'] = ['inline_keyboard' => [[['text' => I18n::t($locale, 'bot.btn.open_app'), 'web_app' => ['url' => $this->miniAppUrl("?p={$appPage}")]]]]];
        }
        try {
            $this->tg->call('sendMessage', $params);
        } catch (\Throwable $e) {
            error_log(scrub('notify failed: ' . $e->getMessage()));
        }
    }

    public function miniAppUrl(string $q = ''): string
    {
        return $this->cfg->baseUrl . '/app/' . $q;
    }

    public static function money(int|string $minor, string $currency, string $locale): string
    {
        $zero = in_array($currency, ['IRR', 'IRT', 'JPY', 'KRW', 'XTR', 'VND'], true);
        $v = $zero ? (string) (int) $minor : number_format(((int) $minor) / 100, 2, '.', ',');
        return "{$v} {$currency}";
    }

    // ── support ─────────────────────────────────────────────────────────────
    public function createTicket(string $userId, ?string $wid, string $category, string $subject, string $body): array
    {
        $id = uuid();
        do { $ref = 'MLR-' . randomCode(6); } while ($this->db->one('SELECT 1 FROM support_tickets WHERE reference = ?', [$ref]));
        $this->db->exec('INSERT INTO support_tickets (id, reference, user_id, workspace_id, category, subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $ref, $userId, $wid, $category, $subject, now(), now()]);
        $this->db->exec('INSERT INTO support_messages (ticket_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?)', [$id, $userId, $body, now()]);
        $this->track('support_ticket_created', $userId, null, ['category' => $category]);
        foreach ($this->cfg->adminIds as $a) $this->notify((int) $a, "🛟 New support ticket {$ref}: " . htmlspecialchars(mb_substr($subject, 0, 80)));
        return ['id' => $id, 'reference' => $ref, 'status' => 'open', 'category' => $category, 'subject' => $subject, 'created_at' => iso(now())];
    }

    public function ticket(string $id, string $userId, bool $asStaff): array
    {
        $t = $this->db->one('SELECT * FROM support_tickets WHERE id = ? AND (? OR user_id = ?)', [$id, $asStaff ? 1 : 0, $userId]);
        if (!$t) throw new AppError('not_found', 'Ticket not found');
        $msgs = array_map(fn($m) => ['id' => (string) $m['id'], 'is_staff' => (bool) $m['is_staff'], 'body' => $m['body'], 'created_at' => iso((int) $m['created_at'])],
            $this->db->all('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY id', [$id]));
        return ['id' => $t['id'], 'reference' => $t['reference'], 'status' => $t['status'], 'category' => $t['category'], 'subject' => $t['subject'],
            'created_at' => iso((int) $t['created_at']), 'messages' => $msgs];
    }

    // ── scheduled work (cron + opportunistic) ───────────────────────────────
    public function runScheduled(bool $force = false): array
    {
        $last = (int) ($this->db->one("SELECT value FROM kv WHERE key = 'cron_last'")['value'] ?? 0);
        if (!$force && now() - $last < 60) return ['skipped' => true];
        $this->db->exec("INSERT INTO kv (key, value) VALUES ('cron_last', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [(string) now()]);
        $expired = $this->db->all("SELECT t.*, u.telegram_user_id, u.locale FROM trials t JOIN users u ON u.id = t.user_id WHERE t.status = 'active' AND t.expires_at <= ?", [now()]);
        foreach ($expired as $t) {
            $this->db->exec("UPDATE trials SET status = 'expired', notified = 1 WHERE id = ?", [$t['id']]);
            $this->track('trial_expired', $t['user_id'], $t['workspace_id']);
            $this->notify($t['telegram_user_id'] ? (int) $t['telegram_user_id'] : null, I18n::t($t['locale'], 'bot.trial_expired'), 'plans', $t['locale']);
        }
        $this->db->exec('DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?', [now() - 7 * 86400, now() - 7 * 86400]);
        $this->db->exec('DELETE FROM rate_limits WHERE win < ?', [intdiv(now(), 60) - 120]);
        foreach ($this->db->all('SELECT user_id FROM account_deletion_requests WHERE completed_at IS NULL AND execute_after <= ?', [now()]) as $d) {
            $this->db->exec('UPDATE sessions SET revoked_at = ? WHERE user_id = ?', [now(), $d['user_id']]);
            $this->db->exec("UPDATE workspaces SET status = 'deleted', store_published = 0 WHERE owner_user_id = ?", [$d['user_id']]);
            $this->db->exec("UPDATE users SET telegram_user_id = NULL, first_name = '', username = NULL, deleted_at = ?, is_blocked = 1 WHERE id = ?", [now(), $d['user_id']]);
            $this->db->exec('UPDATE account_deletion_requests SET completed_at = ? WHERE user_id = ?', [now(), $d['user_id']]);
        }
        return ['expiredTrials' => count($expired)];
    }

    /** Registers the webhook (with our secret) when it is missing or points elsewhere. */
    public function ensureWebhook(): array
    {
        if (!$this->cfg->botToken) return ['webhook' => 'not_configured'];
        $url = $this->cfg->baseUrl . '/tg/webhook';
        $info = $this->tg->call('getWebhookInfo');
        if (($info['url'] ?? '') === $url) return ['webhook' => 'ok'];
        $this->tg->call('setWebhook', ['url' => $url, 'secret_token' => $this->cfg->webhookSecret,
            'allowed_updates' => ['message', 'callback_query', 'pre_checkout_query'], 'drop_pending_updates' => true]);
        $this->tg->call('setChatMenuButton', ['menu_button' => ['type' => 'web_app', 'text' => 'Millerenos', 'web_app' => ['url' => $this->miniAppUrl()]]]);
        return ['webhook' => 'registered'];
    }
}
