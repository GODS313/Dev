<?php
declare(strict_types=1);

namespace Mlr;

final class Request
{
    public function __construct(
        public string $method,
        public string $path,          // path below the base path, e.g. /api/v1/me
        public array $query,
        public array $headers,        // lower-case names
        public string $rawBody,
        public string $ip,
    ) {
    }

    public function json(): array
    {
        if ($this->rawBody === '') return [];
        $d = json_decode($this->rawBody, true);
        if (!is_array($d)) throw new AppError('bad_request', 'Invalid JSON body');
        return $d;
    }

    public function bearer(): ?string
    {
        $h = $this->headers['authorization'] ?? '';
        return str_starts_with($h, 'Bearer ') ? trim(substr($h, 7)) : null;
    }
}

/** Small validation helpers (zod-like, strict). */
final class V
{
    public static function str(array $d, string $k, int $max, int $min = 0, bool $optional = false): ?string
    {
        if (!array_key_exists($k, $d) || $d[$k] === null) {
            if ($optional) return null;
            throw new AppError('validation_failed', "Missing {$k}");
        }
        if (!is_string($d[$k])) throw new AppError('validation_failed', "Invalid {$k}");
        $v = trim($d[$k]);
        if (mb_strlen($v) < $min || mb_strlen($v) > $max) throw new AppError('validation_failed', "Invalid {$k}");
        return $v;
    }

    public static function int(array $d, string $k, int $min, int $max, bool $optional = false, bool $nullable = false): ?int
    {
        if (!array_key_exists($k, $d)) {
            if ($optional) return null;
            throw new AppError('validation_failed', "Missing {$k}");
        }
        if ($d[$k] === null && $nullable) return null;
        if (!is_int($d[$k]) || $d[$k] < $min || $d[$k] > $max) throw new AppError('validation_failed', "Invalid {$k}");
        return $d[$k];
    }

    public static function enum(array $d, string $k, array $allowed, bool $optional = false): ?string
    {
        if (!array_key_exists($k, $d)) {
            if ($optional) return null;
            throw new AppError('validation_failed', "Missing {$k}");
        }
        if (!in_array($d[$k], $allowed, true)) throw new AppError('validation_failed', "Invalid {$k}");
        return $d[$k];
    }

    /** Rejects unknown keys (mass-assignment protection). */
    public static function only(array $d, array $keys): void
    {
        foreach (array_keys($d) as $k) if (!in_array($k, $keys, true)) throw new AppError('validation_failed', "Unknown field {$k}");
    }
}

final class Api
{
    public function __construct(private App $app)
    {
    }

    private function user(Request $r): array
    {
        $t = $r->bearer();
        $u = $t ? $this->app->resolveSession($t) : null;
        if (!$u) throw new AppError('unauthorized', 'Sign in required');
        if ($u['is_blocked']) throw new AppError('forbidden', 'Account is blocked');
        return $u;
    }

    /** @return array{0:int,1:mixed} status and body */
    public function handle(Request $r): array
    {
        $a = $this->app;
        $m = $r->method;
        $p = $r->path;
        if ($m === 'POST' && $p === '/api/v1/auth/telegram') {
            $a->rateLimit('auth:' . $r->ip, 20, 60);
            if (!$a->cfg->botToken) throw new AppError('not_configured', 'Telegram sign-in is not configured');
            $d = $r->json();
            $v = TelegramAuth::validateInitData((string) V::str($d, 'initData', 4096, 1), $a->cfg->botToken);
            [$u] = $a->upsertUser($v['user']);
            if ($u['is_blocked']) throw new AppError('forbidden', 'Account is blocked');
            $s = $a->createSession($u['id']);
            $ws = $a->listUserWorkspaces($u['id']);
            $a->track('miniapp_opened', $u['id'], null, ['has_workspace' => (bool) $ws]);
            return [200, ['token' => $s['token'], 'expiresAt' => $s['expiresAt'], 'user' => App::publicUser($u), 'workspaces' => $ws, 'startParam' => $v['start_param']]];
        }
        if ($m === 'POST' && $p === '/api/v1/auth/logout') {
            if ($t = $r->bearer()) $a->revokeSession($t);
            return [200, ['ok' => true]];
        }
        if ($m === 'GET' && $p === '/api/v1/plans') {
            return [200, ['items' => $a->plans(), 'providers' => [['id' => 'telegram_stars', 'status' => 'OFFICIAL_SUPPORTED', 'storesCardData' => false]]]];
        }
        if ($m === 'GET' && preg_match('#^/api/v1/store/([a-z0-9-]{1,40})$#', $p, $mm)) {
            $a->rateLimit('store:' . $r->ip, 600, 60);
            $s = $a->publicStore($mm[1]);
            return [200, ['store' => $s['store'], 'products' => $a->publicCatalog($s['id'])]];
        }

        $u = $this->user($r);
        $a->rateLimit('u:' . $u['id'], 300, 60);

        if ($p === '/api/v1/me') {
            if ($m === 'GET') return [200, ['user' => App::publicUser($u), 'workspaces' => $a->listUserWorkspaces($u['id']),
                'trialUsed' => (bool) $a->db->one('SELECT 1 FROM trials WHERE user_id = ?', [$u['id']])]];
            if ($m === 'PATCH') {
                $l = V::enum($r->json(), 'locale', ['en', 'fa']);
                $a->db->exec('UPDATE users SET locale = ?, locale_chosen = 1 WHERE id = ?', [$l, $u['id']]);
                return [200, ['ok' => true]];
            }
        }
        if ($m === 'POST' && $p === '/api/v1/trial') {
            $a->rateLimit('trial:' . $u['id'], 5, 60);
            $res = $a->startTrial($u, V::str($r->json(), 'businessName', 80, 1, true));
            if (!$res['started']) throw new AppError('conflict', 'Free trial already used');
            $a->track('trial_activated', $u['id'], $res['workspace']['id'], ['via' => 'miniapp']);
            return [200, ['workspace' => $res['workspace'], 'trial' => ['expiresAt' => $res['expiresAt']]]];
        }
        if ($m === 'POST' && preg_match('#^/api/v1/store/([a-z0-9-]{1,40})/orders$#', $p, $mm)) {
            return [200, $this->storeOrder($r, $u, $mm[1])];
        }

        // ── workspace-scoped ────────────────────────────────────────────────
        if (preg_match('#^/api/v1/workspaces/([^/]+)(/.*)?$#', $p, $mm)) {
            return $this->workspaceRoute($r, $u, $mm[1], $mm[2] ?? '');
        }

        // ── support ─────────────────────────────────────────────────────────
        if ($p === '/api/v1/support/tickets') {
            if ($m === 'GET') return [200, ['items' => array_map(fn($t) => ['id' => $t['id'], 'reference' => $t['reference'], 'status' => $t['status'],
                'category' => $t['category'], 'subject' => $t['subject'], 'created_at' => iso((int) $t['created_at'])],
                $a->db->all('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [$u['id']]))]];
            if ($m === 'POST') {
                $a->rateLimit('ticket:' . $u['id'], 5, 600);
                $d = $r->json();
                $wid = $d['workspaceId'] ?? null;
                if ($wid !== null) $a->requireRole((string) $wid, $u['id'], 'staff');
                return [200, $a->createTicket($u['id'], $wid, V::enum($d, 'category', ['technical', 'payment', 'account', 'other']),
                    V::str($d, 'subject', 160, 1), V::str($d, 'body', 4000, 1))];
            }
        }
        if (preg_match('#^/api/v1/support/tickets/([0-9a-f-]{36})(/messages)?$#', $p, $mm)) {
            if ($m === 'GET' && empty($mm[2])) return [200, $a->ticket($mm[1], $u['id'], false)];
            if ($m === 'POST' && !empty($mm[2])) {
                $a->rateLimit('msg:' . $u['id'], 20, 600);
                $a->ticket($mm[1], $u['id'], false);
                $a->db->exec('INSERT INTO support_messages (ticket_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?)', [$mm[1], $u['id'], V::str($r->json(), 'body', 4000, 1), now()]);
                $a->db->exec("UPDATE support_tickets SET status = 'open', updated_at = ? WHERE id = ?", [now(), $mm[1]]);
                return [200, ['ok' => true]];
            }
        }

        // ── account ─────────────────────────────────────────────────────────
        if ($m === 'GET' && $p === '/api/v1/account/export') {
            $a->rateLimit('export:' . $u['id'], 3, 3600);
            return [200, ['generatedAt' => iso(now()), 'user' => App::publicUser($u) + ['telegramUserId' => (string) $u['telegram_user_id'], 'createdAt' => iso((int) $u['created_at'])],
                'memberships' => $a->listUserWorkspaces($u['id']),
                'trials' => $a->db->all('SELECT started_at, expires_at, status FROM trials WHERE user_id = ?', [$u['id']]),
                'supportTickets' => $a->db->all('SELECT reference, subject, status, created_at FROM support_tickets WHERE user_id = ?', [$u['id']])]];
        }
        if ($p === '/api/v1/account/deletion') {
            if ($m === 'POST') {
                $a->db->exec('INSERT INTO account_deletion_requests (user_id, requested_at, execute_after) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING', [$u['id'], now(), now() + 14 * 86400]);
                $a->audit('account.deletion_requested', $u['id']);
                $row = $a->db->one('SELECT execute_after FROM account_deletion_requests WHERE user_id = ?', [$u['id']]);
                return [200, ['executeAfter' => iso((int) $row['execute_after'])]];
            }
            if ($m === 'DELETE') {
                if (!$a->db->exec('DELETE FROM account_deletion_requests WHERE user_id = ? AND completed_at IS NULL', [$u['id']])) throw new AppError('not_found', 'No pending deletion request');
                return [200, ['ok' => true]];
            }
        }

        // ── platform admin ──────────────────────────────────────────────────
        if (str_starts_with($p, '/api/admin/')) return $this->admin($r, $u, substr($p, 11));

        throw new AppError('not_found', 'Not found');
    }

    private function workspaceRoute(Request $r, array $u, string $wid, string $sub): array
    {
        $a = $this->app;
        $m = $r->method;
        $role = $a->requireRole($wid, $u['id'], 'staff');
        $isAdmin = $role !== 'staff';
        $needAdmin = function () use ($isAdmin) {
            if (!$isAdmin) throw new AppError('forbidden', 'Insufficient role');
        };

        if ($sub === '' && $m === 'GET') {
            $ws = $a->workspace($wid);
            return [200, ['workspace' => $ws, 'role' => $role, 'access' => $a->access($wid), 'onboarding' => $a->onboarding($wid),
                'usage' => ['products' => $a->countProducts($wid), 'orders' => $a->countOrders($wid)], 'storeLink' => $a->storeLink($ws['slug'])]];
        }
        if ($sub === '' && $m === 'PATCH') {
            $needAdmin();
            $d = $r->json();
            V::only($d, ['name', 'default_locale', 'currency', 'ai_mode', 'business_policies', 'store_published', 'store_settings']);
            $before = $a->workspace($wid);
            $sets = [];
            $vals = [];
            if (array_key_exists('name', $d)) { $sets[] = 'name = ?'; $vals[] = V::str($d, 'name', 80, 1); }
            if (array_key_exists('default_locale', $d)) { $sets[] = 'default_locale = ?'; $vals[] = V::enum($d, 'default_locale', ['en', 'fa']); }
            if (array_key_exists('ai_mode', $d)) { $sets[] = 'ai_mode = ?'; $vals[] = V::enum($d, 'ai_mode', ['MANUAL', 'SUGGEST_ONLY', 'APPROVAL_REQUIRED', 'AUTO_ALLOWED']); }
            if (array_key_exists('business_policies', $d)) { $sets[] = 'business_policies = ?'; $vals[] = V::str($d, 'business_policies', 4000); }
            if (array_key_exists('currency', $d)) {
                if (!is_string($d['currency']) || !preg_match('/^[A-Z]{3}$/', $d['currency'])) throw new AppError('validation_failed', 'Invalid currency');
                if ($a->countOrders($wid) > 0) throw new AppError('conflict', 'Currency cannot change after the first order');
                $sets[] = 'currency = ?'; $vals[] = $d['currency'];
            }
            if (array_key_exists('store_published', $d)) {
                if (!is_bool($d['store_published'])) throw new AppError('validation_failed', 'Invalid store_published');
                if ($d['store_published']) App::requireWrite($a->access($wid));
                $sets[] = 'store_published = ?'; $vals[] = $d['store_published'] ? 1 : 0;
            }
            if (array_key_exists('store_settings', $d)) {
                $s = $d['store_settings'];
                if (!is_array($s)) throw new AppError('validation_failed', 'Invalid store_settings');
                V::only($s, ['tagline', 'support_contact', 'delivery_info']);
                $clean = ['tagline' => V::str($s, 'tagline', 160, 0, true) ?? '', 'support_contact' => V::str($s, 'support_contact', 120, 0, true) ?? '',
                    'delivery_info' => V::str($s, 'delivery_info', 500, 0, true) ?? ''];
                $sets[] = 'store_settings = ?'; $vals[] = json_encode($clean, JSON_UNESCAPED_UNICODE);
            }
            if ($sets) $a->db->exec('UPDATE workspaces SET ' . implode(', ', $sets) . ' WHERE id = ?', array_merge($vals, [$wid]));
            $a->audit('workspace.updated', $u['id'], $wid, null, null, ['fields' => array_keys($d)]);
            if (!empty($d['store_published']) && !$before['store_published']) $a->track('store_published', $u['id'], $wid);
            return [200, ['workspace' => $a->workspace($wid)]];
        }

        $productIn = function (array $d, bool $partial): array {
            V::only($d, ['name', 'description', 'kind', 'categoryId', 'status', 'priceMinor', 'stock', 'sku']);
            $o = [];
            if (!$partial || array_key_exists('name', $d)) $o['name'] = V::str($d, 'name', 120, 1);
            if (array_key_exists('description', $d)) $o['description'] = V::str($d, 'description', 4000);
            if (array_key_exists('kind', $d)) $o['kind'] = V::enum($d, 'kind', ['physical', 'service', 'digital']);
            if (array_key_exists('status', $d)) $o['status'] = V::enum($d, 'status', ['draft', 'active', 'archived']);
            if (!$partial || array_key_exists('priceMinor', $d)) $o['priceMinor'] = V::int($d, 'priceMinor', 0, 10 ** 13);
            if (array_key_exists('stock', $d)) $o['stock'] = V::int($d, 'stock', 0, 1000000, false, true);
            if (array_key_exists('sku', $d)) $o['sku'] = $d['sku'] === null ? null : V::str($d, 'sku', 64);
            return $o;
        };

        if ($sub === '/products') {
            if ($m === 'GET') return [200, ['items' => $a->listProducts($wid, V::enum($r->query, 'status', ['draft', 'active', 'archived'], true)), 'nextCursor' => null]];
            if ($m === 'POST') {
                $in = $productIn($r->json(), false);
                $acc = $a->access($wid);
                App::requireWrite($acc);
                if ($a->countProducts($wid) >= $acc['limits']['products']) throw new AppError('quota_exceeded', 'Product limit reached for your plan', ['limit' => $acc['limits']['products']]);
                $prod = $a->createProduct($wid, $in);
                $a->track('product_created', $u['id'], $wid);
                return [200, $prod];
            }
        }
        if (preg_match('#^/products/([0-9a-f-]{36})$#', $sub, $mm)) {
            if ($m === 'GET') return [200, $a->product($wid, $mm[1])];
            if ($m === 'PATCH') {
                $in = $productIn($r->json(), true);
                App::requireWrite($a->access($wid));
                return [200, $a->updateProduct($wid, $mm[1], $in)];
            }
        }
        if ($sub === '/categories' && $m === 'GET') return [200, ['items' => []]];
        if ($sub === '/orders' && $m === 'GET') {
            return [200, ['items' => $a->listOrders($wid, V::enum($r->query, 'status', array_keys(App::TRANSITIONS), true)), 'nextCursor' => null]];
        }
        if (preg_match('#^/orders/([0-9a-f-]{36})$#', $sub, $mm) && $m === 'GET') return [200, $a->order($wid, $mm[1])];
        if (preg_match('#^/orders/([0-9a-f-]{36})/status$#', $sub, $mm) && $m === 'POST') {
            return [200, $a->transitionOrder($wid, $mm[1], (string) V::enum($r->json(), 'status', ['confirmed', 'paid', 'fulfilled', 'cancelled', 'refunded']), $u['id'])];
        }
        if ($sub === '/customers' && $m === 'GET') {
            $q = isset($r->query['q']) && is_string($r->query['q']) ? mb_substr($r->query['q'], 0, 80) : null;
            return [200, ['items' => array_map(fn($c) => ['id' => $c['id'], 'display_name' => $c['display_name'], 'orders_count' => (int) $c['n'], 'created_at' => iso((int) $c['created_at'])],
                $a->db->all("SELECT c.*, (SELECT count(*) FROM orders o WHERE o.workspace_id = c.workspace_id AND o.customer_id = c.id) n FROM customers c
                    WHERE c.workspace_id = ? AND (? IS NULL OR c.display_name LIKE '%' || ? || '%' ESCAPE '\\') ORDER BY c.created_at DESC LIMIT 100",
                    [$wid, $q, $q === null ? null : addcslashes($q, '%_\\')]))]];
        }
        if ($sub === '/faq') {
            if ($m === 'GET') return [200, ['items' => $a->db->all('SELECT id, question, answer FROM faq_entries WHERE workspace_id = ? ORDER BY created_at', [$wid])]];
            if ($m === 'POST') {
                $needAdmin();
                App::requireWrite($a->access($wid));
                $d = $r->json();
                if ((int) $a->db->one('SELECT count(*) n FROM faq_entries WHERE workspace_id = ?', [$wid])['n'] >= 100) throw new AppError('quota_exceeded', 'FAQ limit reached');
                $id = uuid();
                $a->db->exec('INSERT INTO faq_entries (id, workspace_id, question, answer, created_at) VALUES (?, ?, ?, ?, ?)', [$id, $wid, V::str($d, 'question', 500, 1), V::str($d, 'answer', 2000, 1), now()]);
                return [200, $a->db->one('SELECT id, question, answer FROM faq_entries WHERE id = ?', [$id])];
            }
        }
        if (preg_match('#^/faq/([0-9a-f-]{36})$#', $sub, $mm) && $m === 'DELETE') {
            $needAdmin();
            $a->db->exec('DELETE FROM faq_entries WHERE workspace_id = ? AND id = ?', [$wid, $mm[1]]);
            return [200, ['ok' => true]];
        }
        if (str_starts_with($sub, '/ai/')) throw new AppError('not_configured', 'AI assistant is not configured yet');
        if ($sub === '/billing' && $m === 'GET') {
            $needAdmin();
            return [200, ['subscription' => $a->db->one('SELECT plan_code, status, current_period_end FROM subscriptions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1', [$wid]),
                'invoices' => $a->db->all('SELECT id, plan_code, provider, currency, amount_minor, status, created_at FROM invoices WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20', [$wid]),
                'access' => $a->access($wid)]];
        }
        if ($sub === '/billing/checkout' && $m === 'POST') {
            $needAdmin();
            $a->rateLimit('checkout:' . $u['id'], 10, 60);
            $plan = V::str($r->json(), 'plan', 32, 2);
            if (!preg_match('/^[a-z0-9_]+$/', $plan)) throw new AppError('validation_failed', 'Invalid plan');
            return [200, $a->createCheckout($wid, $u, $plan)];
        }
        throw new AppError('not_found', 'Not found');
    }

    private function storeOrder(Request $r, array $u, string $slug): array
    {
        $a = $this->app;
        $a->rateLimit('order:' . $u['id'], 10, 60);
        if (!$u['telegram_user_id']) throw new AppError('forbidden', 'Telegram account required');
        $d = $r->json();
        $items = $d['items'] ?? null;
        if (!is_array($items) || !$items || count($items) > 20) throw new AppError('validation_failed', 'Invalid items');
        foreach ($items as $it) {
            if (!is_array($it) || !isUuid($it['variantId'] ?? null) || !is_int($it['quantity'] ?? null) || $it['quantity'] < 1 || $it['quantity'] > 99) {
                throw new AppError('validation_failed', 'Invalid items');
            }
        }
        $idem = $d['idempotencyKey'] ?? '';
        if (!is_string($idem) || !preg_match('/^[A-Za-z0-9_-]{8,128}$/', $idem)) throw new AppError('validation_failed', 'Invalid idempotencyKey');
        $note = V::str($d, 'note', 500, 0, true) ?? '';
        $store = $a->publicStore($slug);
        $wid = $store['id'];
        $acc = $a->access($wid);
        App::requireWrite($acc);
        if ($acc['limits']['orders'] !== null && $a->countOrders($wid) >= $acc['limits']['orders']) throw new AppError('quota_exceeded', 'This store cannot accept more orders right now');
        $first = $a->countOrders($wid) === 0;
        $cid = $a->upsertCustomer($wid, (int) $u['telegram_user_id'], $u['first_name']);
        $res = $a->createOrder($wid, $items, $cid, $note, 'telegram', substr("c_{$u['id']}_{$idem}", 0, 128));
        $o = $res['order'];
        if ($res['created']) {
            $a->track('order_created', null, $wid, ['channel' => 'telegram']);
            if ($first) $a->track('first_order', null, $wid);
            $owner = $a->db->one('SELECT u.telegram_user_id, u.locale FROM workspaces w JOIN users u ON u.id = w.owner_user_id WHERE w.id = ?', [$wid]);
            $a->notify($owner['telegram_user_id'] ? (int) $owner['telegram_user_id'] : null, I18n::t($owner['locale'], 'bot.new_order', [
                'number' => $o['number'], 'total' => App::money($o['total_minor'], $o['currency'], $owner['locale']), 'customer' => htmlspecialchars($u['first_name']),
            ]), 'orders', $owner['locale']);
        }
        return ['order' => ['id' => $o['id'], 'number' => $o['number'], 'status' => $o['status'], 'total_minor' => $o['total_minor'], 'currency' => $o['currency'], 'items' => $o['items']],
            'deliveryInfo' => $store['store']['deliveryInfo'], 'supportContact' => $store['store']['supportContact']];
    }

    /** Platform admin: hidden (404) from non-staff; mutations audited. */
    private function admin(Request $r, array $u, string $p): array
    {
        $a = $this->app;
        if (!in_array($u['platform_role'], ['support', 'admin', 'superadmin'], true)) throw new AppError('not_found', 'Not found');
        $n = fn(string $sql, array $args = []) => (int) $a->db->one($sql, $args)['n'];
        if ($p === 'overview' && $r->method === 'GET') {
            $funnel = [];
            foreach ($a->db->all('SELECT name, count(DISTINCT coalesce(user_id, workspace_id)) n FROM analytics_events WHERE created_at > ? GROUP BY name', [now() - 7 * 86400]) as $row) $funnel[$row['name']] = (int) $row['n'];
            return [200, ['counts' => [
                'users' => $n('SELECT count(*) n FROM users WHERE deleted_at IS NULL'),
                'workspaces' => $n("SELECT count(*) n FROM workspaces WHERE status = 'active'"),
                'active_trials' => $n("SELECT count(*) n FROM trials WHERE status = 'active' AND expires_at > ?", [now()]),
                'active_subscriptions' => $n("SELECT count(*) n FROM subscriptions WHERE status = 'active' AND current_period_end > ?", [now()]),
                'orders_7d' => $n('SELECT count(*) n FROM orders WHERE created_at > ?', [now() - 7 * 86400]),
                'stars_30d' => (string) ($a->db->one("SELECT coalesce(sum(amount_minor), 0) s FROM payments WHERE provider = 'telegram_stars' AND created_at > ?", [now() - 30 * 86400])['s']),
                'open_tickets' => $n("SELECT count(*) n FROM support_tickets WHERE status IN ('open', 'pending')"),
                'payments_needing_review' => $n("SELECT count(*) n FROM audit_logs WHERE action = 'payment.needs_review'"),
            ], 'funnel7d' => $funnel]];
        }
        if ($p === 'health' && $r->method === 'GET') {
            $t = microtime(true);
            $a->db->one('SELECT 1');
            return [200, ['db' => ['ok' => true, 'latencyMs' => (int) round((microtime(true) - $t) * 1000)],
                'jobs' => ['stats' => ['last_cron' => iso((int) ($a->db->one("SELECT value FROM kv WHERE key = 'cron_last'")['value'] ?? 0))]],
                'backups' => [], 'integrations' => ['telegram' => $a->cfg->botToken ? 'configured' : 'not_configured', 'ai' => 'not_configured', 'edition' => 'shared-hosting (PHP + SQLite)'],
                'process' => ['php' => PHP_VERSION]]];
        }
        if ($p === 'support' && $r->method === 'GET') {
            return [200, ['items' => $a->db->all("SELECT id, reference, category, status, subject FROM support_tickets ORDER BY (status IN ('open','pending')) DESC, updated_at DESC LIMIT 100")]];
        }
        if (preg_match('#^support/([0-9a-f-]{36})/reply$#', $p, $mm) && $r->method === 'POST') {
            $d = $r->json();
            $a->ticket($mm[1], $u['id'], true);
            $a->db->exec('INSERT INTO support_messages (ticket_id, author_user_id, is_staff, body, created_at) VALUES (?, ?, 1, ?, ?)', [$mm[1], $u['id'], V::str($d, 'body', 4000, 1), now()]);
            $a->db->exec('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?', [!empty($d['close']) ? 'resolved' : 'pending', now(), $mm[1]]);
            $a->audit('support.replied', $u['id'], null, 'ticket', $mm[1]);
            $owner = $a->db->one('SELECT u.telegram_user_id, u.locale, t.reference FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?', [$mm[1]]);
            $a->notify($owner['telegram_user_id'] ? (int) $owner['telegram_user_id'] : null, I18n::t($owner['locale'], 'bot.ticket_reply', ['ref' => $owner['reference']]), 'support', $owner['locale']);
            return [200, ['ok' => true]];
        }
        if (preg_match('#^users/([0-9a-f-]{36})/block$#', $p, $mm) && $r->method === 'POST') {
            if (!in_array($u['platform_role'], ['admin', 'superadmin'], true)) throw new AppError('not_found', 'Not found');
            $d = $r->json();
            if (!is_bool($d['blocked'] ?? null)) throw new AppError('validation_failed', 'Invalid blocked');
            $reason = V::str($d, 'reason', 300, 3);
            if ($mm[1] === $u['id']) throw new AppError('bad_request', 'You cannot block yourself');
            $t = $a->user($mm[1]);
            if (!$t) throw new AppError('not_found', 'User not found');
            if ($t['platform_role'] === 'superadmin') throw new AppError('forbidden', 'Superadmins cannot be blocked here');
            $a->db->exec('UPDATE users SET is_blocked = ? WHERE id = ?', [$d['blocked'] ? 1 : 0, $mm[1]]);
            if ($d['blocked']) $a->db->exec('UPDATE sessions SET revoked_at = ? WHERE user_id = ?', [now(), $mm[1]]);
            $a->audit($d['blocked'] ? 'admin.user_blocked' : 'admin.user_unblocked', $u['id'], null, 'user', $mm[1], ['reason' => $reason]);
            return [200, ['ok' => true]];
        }
        if ($p === 'audit' && $r->method === 'GET') {
            if (!in_array($u['platform_role'], ['admin', 'superadmin'], true)) throw new AppError('not_found', 'Not found');
            $act = isset($r->query['action']) && is_string($r->query['action']) ? $r->query['action'] : null;
            return [200, ['items' => $a->db->all('SELECT * FROM audit_logs WHERE (? IS NULL OR action = ?) ORDER BY id DESC LIMIT 200', [$act, $act])]];
        }
        throw new AppError('not_found', 'Not found');
    }
}
