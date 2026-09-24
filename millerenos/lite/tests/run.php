<?php
declare(strict_types=1);

// Millerenos shared-hosting edition — tests. Run: php lite/tests/run.php
namespace Mlr;

require __DIR__ . '/../src/bootstrap.php';

const TOKEN = '123456789:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';

final class FakeTg implements TelegramApi
{
    public array $calls = [];
    public function call(string $method, array $params = []): mixed
    {
        $this->calls[] = [$method, $params];
        return match ($method) {
            'createInvoiceLink' => 'https://t.me/$invoice_test',
            'getWebhookInfo' => ['url' => ''],
            'sendMessage' => ['message_id' => 1],
            default => true,
        };
    }
    public function last(string $m): ?array
    {
        foreach (array_reverse($this->calls) as $c) if ($c[0] === $m) return $c[1];
        return null;
    }
}

$pass = 0;
$fail = 0;
function check(bool $cond, string $name): void
{
    global $pass, $fail;
    if ($cond) { $pass++; } else { $fail++; fwrite(STDERR, "FAIL: {$name}\n"); }
}
function suite(string $name, callable $fn): void
{
    echo "# {$name}\n";
    try { $fn(); } catch (\Throwable $e) { global $fail; $fail++; fwrite(STDERR, "ERROR in {$name}: " . get_class($e) . ' ' . $e->getMessage() . ' @' . $e->getLine() . "\n"); }
}

function harness(array $env = []): array
{
    $root = sys_get_temp_dir() . '/mlr-test-' . bin2hex(random_bytes(4));
    mkdir($root . '/config', 0700, true);
    $env += ['PUBLIC_BASE_URL' => 'https://etebarami.test/God', 'TELEGRAM_BOT_TOKEN' => TOKEN, 'TELEGRAM_BOT_USERNAME' => 'mlr_test_bot', 'PLATFORM_ADMIN_TELEGRAM_IDS' => '999'];
    file_put_contents($root . '/config/app.env', implode("\n", array_map(fn($k, $v) => "{$k}={$v}", array_keys($env), $env)));
    $tg = new FakeTg();
    $app = boot($root, $tg);
    $public = sys_get_temp_dir() . '/mlr-pub-' . bin2hex(random_bytes(4));
    @mkdir($public . '/en', 0700, true);
    file_put_contents($public . '/404.html', '<h1>Not found</h1>');
    file_put_contents($public . '/en/status.html', '<span class="badge ok">All systems operational</span>');
    $factory = function (string $token) {
        $f = new class ($token) implements TelegramApi {
            public array $calls = [];
            public function __construct(private string $t) {}
            public function call(string $method, array $params = []): mixed
            {
                $this->calls[] = [$method, $params];
                if ($method === 'getMe') {
                    if (str_starts_with($this->t, '000')) throw new \RuntimeException('Unauthorized');
                    return ['username' => str_starts_with($this->t, '111') ? 'other_bot' : 'mlr_test_bot'];
                }
                return $method === 'getWebhookInfo' ? ['url' => ''] : true;
            }
        };
        $GLOBALS['lastFactoryTg'] = $f;
        return $f;
    };
    return [$app, $tg, new Kernel($app, $public, $root, $factory), $root];
}

function req(Kernel $k, string $method, string $path, mixed $body = null, ?string $token = null, array $headers = [], array $query = []): array
{
    $h = $headers + ($token ? ['authorization' => "Bearer {$token}"] : []);
    [$s, $hh, $b] = $k->handle(new Request($method, $path, $query, $h, $body === null ? '' : (is_string($body) ? $body : json_encode($body)), '10.0.0.1'));
    return ['status' => $s, 'headers' => $hh, 'body' => $b, 'json' => json_decode($b, true)];
}

function login(Kernel $k, int $tgId, string $name = 'Test', string $lang = 'en'): array
{
    $init = TelegramAuth::signInitData(['auth_date' => (string) time(), 'user' => json_encode(['id' => $tgId, 'first_name' => $name, 'language_code' => $lang])], TOKEN);
    $r = req($k, 'POST', '/api/v1/auth/telegram', ['initData' => $init]);
    if ($r['status'] !== 200) throw new \RuntimeException("login failed {$r['status']} {$r['body']}");
    return $r['json'];
}

function withTrial(Kernel $k, int $tgId, string $biz = 'Shop'): array
{
    $s = login($k, $tgId);
    $r = req($k, 'POST', '/api/v1/trial', ['businessName' => $biz], $s['token']);
    if ($r['status'] !== 200) throw new \RuntimeException("trial failed {$r['body']}");
    return ['token' => $s['token'], 'user' => $s['user'], 'wid' => $r['json']['workspace']['id'], 'slug' => $r['json']['workspace']['slug']];
}

function update(array $body): string
{
    static $id = 1000;
    return json_encode(['update_id' => $id++] + $body);
}

suite('init data validation', function () {
    $now = time();
    $good = TelegramAuth::signInitData(['auth_date' => (string) $now, 'user' => json_encode(['id' => 7, 'first_name' => 'A'])], TOKEN);
    check(TelegramAuth::validateInitData($good, TOKEN)['user']['id'] === 7, 'valid init data accepted');
    $bad = str_replace('%22id%22%3A7', '%22id%22%3A8', $good);
    try { TelegramAuth::validateInitData($bad, TOKEN); check(false, 'tampered rejected'); } catch (AppError $e) { check($e->errCode === 'unauthorized', 'tampered rejected'); }
    $old = TelegramAuth::signInitData(['auth_date' => (string) ($now - 7200), 'user' => json_encode(['id' => 7])], TOKEN);
    try { TelegramAuth::validateInitData($old, TOKEN); check(false, 'expired rejected'); } catch (AppError) { check(true, 'expired rejected'); }
    $other = TelegramAuth::signInitData(['auth_date' => (string) $now, 'user' => json_encode(['id' => 7])], '1:other');
    try { TelegramAuth::validateInitData($other, TOKEN); check(false, 'wrong token rejected'); } catch (AppError) { check(true, 'wrong token rejected'); }
});

suite('tenant isolation (IDOR/BOLA)', function () {
    [$app, , $k] = harness();
    $a = withTrial($k, 1001, 'Alpha');
    $b = withTrial($k, 1002, 'Beta');
    $p = req($k, 'POST', "/api/v1/workspaces/{$a['wid']}/products", ['name' => 'Secret', 'priceMinor' => 1000, 'stock' => 5], $a['token']);
    check($p['status'] === 200, 'create product');
    $pid = $p['json']['id'];
    foreach ([['GET', ''], ['GET', '/products'], ['GET', "/products/{$pid}"], ['GET', '/orders'], ['GET', '/customers'], ['PATCH', '']] as [$m, $sub]) {
        $r = req($k, $m, "/api/v1/workspaces/{$a['wid']}{$sub}", $m === 'PATCH' ? ['name' => 'pwned'] : null, $b['token']);
        check($r['status'] === 404, "B cannot {$m} A{$sub} ({$r['status']})");
    }
    check(req($k, 'GET', "/api/v1/workspaces/{$b['wid']}/products/{$pid}", null, $b['token'])['status'] === 404, 'IDOR via own workspace blocked');
    check(req($k, 'PATCH', "/api/v1/workspaces/{$b['wid']}/products/{$pid}", ['priceMinor' => 1], $b['token'])['status'] === 404, 'IDOR patch blocked');
    check($app->product($a['wid'], $pid)['variants'][0]['price_minor'] === '1000', 'price unchanged');
    check(req($k, 'GET', '/api/v1/me')['status'] === 401, 'auth required');
    check(req($k, 'GET', '/api/v1/me', null, str_repeat('A', 43))['status'] === 401, 'forged token rejected');
    check(req($k, 'GET', '/api/v1/workspaces/not-a-uuid', null, $a['token'])['status'] === 422, 'bad uuid 422');
    check(req($k, 'PATCH', "/api/v1/workspaces/{$a['wid']}", ['owner_user_id' => 'x'], $a['token'])['status'] === 422, 'mass assignment rejected');
    check(req($k, 'GET', '/api/admin/overview', null, $a['token'])['status'] === 404, 'admin hidden from users');
    $admin = login($k, 999);
    check($admin['user']['platformRole'] === 'superadmin', 'configured admin is superadmin');
    $ov = req($k, 'GET', '/api/admin/overview', null, $admin['token']);
    check($ov['status'] === 200 && $ov['json']['counts']['workspaces'] >= 2, 'admin overview');
    $t = req($k, 'POST', '/api/v1/support/tickets', ['category' => 'technical', 'subject' => 'Help', 'body' => 'x'], $a['token']);
    check((bool) preg_match('/^MLR-[A-Z0-9]{6}$/', $t['json']['reference'] ?? ''), 'ticket reference');
    check(req($k, 'GET', "/api/v1/support/tickets/{$t['json']['id']}", null, $b['token'])['status'] === 404, 'ticket private');
    req($k, 'POST', '/api/v1/auth/logout', null, $a['token']);
    check(req($k, 'GET', '/api/v1/me', null, $a['token'])['status'] === 401, 'logout revokes session');
});

suite('trial rules', function () {
    [$app, $tg, $k] = harness(['TRIAL_DURATION_MINUTES' => '60']);
    $s = withTrial($k, 2001);
    $ws = req($k, 'GET', "/api/v1/workspaces/{$s['wid']}", null, $s['token'])['json'];
    check($ws['access']['state'] === 'trial' && $ws['access']['secondsLeft'] > 3500, 'trial active 60 min');
    check(req($k, 'POST', '/api/v1/trial', [], $s['token'])['status'] === 409, 'second trial refused');
    for ($i = 0; $i < 25; $i++) req($k, 'POST', "/api/v1/workspaces/{$s['wid']}/products", ['name' => "P{$i}", 'priceMinor' => 1], $s['token']);
    $q = req($k, 'POST', "/api/v1/workspaces/{$s['wid']}/products", ['name' => 'over', 'priceMinor' => 1], $s['token']);
    check($q['status'] === 429 && $q['json']['error']['code'] === 'quota_exceeded', 'product quota');
    $app->db->exec('UPDATE trials SET expires_at = ? WHERE workspace_id = ?', [time() - 1, $s['wid']]);
    $out = $app->runScheduled(true);
    check($out['expiredTrials'] === 1, 'cron expires trial');
    check(str_contains((string) ($tg->last('sendMessage')['text'] ?? ''), 'trial has ended'), 'expiry notification sent');
    $w = req($k, 'POST', "/api/v1/workspaces/{$s['wid']}/products", ['name' => 'x', 'priceMinor' => 1], $s['token']);
    check($w['status'] === 402, 'writes blocked after expiry');
    check(count(req($k, 'GET', "/api/v1/workspaces/{$s['wid']}/products", null, $s['token'])['json']['items']) === 25, 'data kept after expiry');
    // deletion + re-register cannot farm a second trial
    $d = withTrial($k, 2002);
    req($k, 'POST', '/api/v1/account/deletion', null, $d['token']);
    $app->db->exec('UPDATE account_deletion_requests SET execute_after = ?', [time() - 1]);
    $app->runScheduled(true);
    $again = login($k, 2002);
    check($again['user']['id'] !== $d['user']['id'], 'deleted account anonymized');
    check(req($k, 'POST', '/api/v1/trial', [], $again['token'])['status'] === 409, 'trial farming blocked');
});

suite('commerce', function () {
    [$app, $tg, $k] = harness();
    $m = withTrial($k, 4001, 'Tea House');
    $p = req($k, 'POST', "/api/v1/workspaces/{$m['wid']}/products", ['name' => 'Green tea', 'priceMinor' => 1250, 'stock' => 3], $m['token'])['json'];
    $vid = $p['variants'][0]['id'];
    check(req($k, 'GET', "/api/v1/store/{$m['slug']}")['status'] === 404, 'unpublished store hidden');
    req($k, 'PATCH', "/api/v1/workspaces/{$m['wid']}", ['store_published' => true, 'store_settings' => ['delivery_info' => 'Pickup']], $m['token']);
    $st = req($k, 'GET', "/api/v1/store/{$m['slug']}");
    check($st['status'] === 200 && !isset($st['json']['store']['id']) && !str_contains($st['body'], '"stock"'), 'public store exposes only public fields');
    $c = login($k, 4002, 'Customer');
    $place = fn($qty, $key, $tok = null) => req($k, 'POST', "/api/v1/store/{$m['slug']}/orders", ['items' => [['variantId' => $vid, 'quantity' => $qty]], 'idempotencyKey' => $key, 'priceMinor' => 1], $tok ?? $c['token']);
    $o1 = $place(2, 'order-key-0001');
    check($o1['status'] === 200 && $o1['json']['order']['total_minor'] === '2500', 'server-side price');
    check($place(2, 'order-key-0001')['json']['order']['id'] === $o1['json']['order']['id'], 'idempotent order');
    check((int) $app->db->one('SELECT stock FROM product_variants WHERE id = ?', [$vid])['stock'] === 1, 'stock decremented');
    check(str_contains((string) ($tg->last('sendMessage')['text'] ?? ''), 'New order'), 'merchant notified');
    check($place(5, 'order-key-0002')['status'] === 409, 'oversell refused');
    $other = withTrial($k, 4003, 'Other');
    $op = req($k, 'POST', "/api/v1/workspaces/{$other['wid']}/products", ['name' => 'Foreign', 'priceMinor' => 1], $other['token'])['json'];
    $f = req($k, 'POST', "/api/v1/store/{$m['slug']}/orders", ['items' => [['variantId' => $op['variants'][0]['id'], 'quantity' => 1]], 'idempotencyKey' => 'order-key-0003'], $c['token']);
    check($f['status'] === 422, 'foreign variant refused');
    $oid = $o1['json']['order']['id'];
    check(req($k, 'POST', "/api/v1/workspaces/{$m['wid']}/orders/{$oid}/status", ['status' => 'refunded'], $m['token'])['status'] === 409, 'invalid transition');
    check(req($k, 'POST', "/api/v1/workspaces/{$m['wid']}/orders/{$oid}/status", ['status' => 'cancelled'], $m['token'])['status'] === 200, 'cancel');
    check((int) $app->db->one('SELECT stock FROM product_variants WHERE id = ?', [$vid])['stock'] === 3, 'cancel returns stock');
    $ws = req($k, 'GET', "/api/v1/workspaces/{$m['wid']}", null, $m['token'])['json'];
    check($ws['onboarding']['completed'] === 4 && $ws['storeLink'] === "https://t.me/mlr_test_bot?start=store_{$m['slug']}", 'onboarding + store link');
    check(count(req($k, 'GET', "/api/v1/workspaces/{$m['wid']}/customers", null, $m['token'])['json']['items']) === 1, 'customers listed');
});

suite('bot + webhook', function () {
    [$app, $tg, $k] = harness();
    $secret = $app->cfg->webhookSecret;
    $from = ['id' => 5001, 'is_bot' => false, 'first_name' => 'Sara', 'language_code' => 'fa'];
    $chat = ['id' => 5001, 'type' => 'private'];
    $hook = fn(array $u, ?string $s = null) => req($k, 'POST', '/tg/webhook', update($u), null, ['x-telegram-bot-api-secret-token' => $s ?? $secret]);
    check($hook(['message' => ['text' => 'x']], 'wrong')['status'] === 401, 'webhook secret enforced');
    $hook(['message' => ['message_id' => 1, 'chat' => $chat, 'from' => $from, 'text' => '/start src_instagram']]);
    $m = $tg->last('sendMessage');
    check(str_contains($m['text'], 'زبان') && $m['reply_markup']['inline_keyboard'][0][1]['callback_data'] === 'lang:fa', 'language prompt (fa guessed)');
    check(json_decode($app->db->one("SELECT props FROM analytics_events WHERE name = 'bot_started'")['props'], true)['source'] === 'instagram', 'source tracked');
    $cb = fn(string $d) => ['callback_query' => ['id' => 'cb' . mt_rand(), 'from' => $from, 'data' => $d, 'message' => ['message_id' => 2, 'chat' => $chat]]];
    $hook($cb('lang:en'));
    $e = $tg->last('editMessageText');
    $btns = array_merge(...$e['reply_markup']['inline_keyboard']);
    check((bool) array_filter($btns, fn($b) => ($b['callback_data'] ?? '') === 'trial:start'), 'main menu has trial button');
    check((bool) array_filter($btns, fn($b) => ($b['web_app']['url'] ?? '') === 'https://etebarami.test/God/app/'), 'mini app button under /God');
    $hook($cb('trial:start'));
    check(str_contains($tg->last('sendMessage')['text'], 'free trial is active'), 'trial via bot');
    $hook($cb('trial:start'));
    check(str_contains($tg->last('sendMessage')['text'], 'already used'), 'trial once via bot');
    $hook($cb('menu:business'));
    check(str_contains($tg->last('editMessageText')['text'], 'Trial'), 'business summary');
    $hook($cb('plan:buy:starter'));
    $inv = $tg->last('createInvoiceLink');
    check($inv['currency'] === 'XTR' && $inv['provider_token'] === '' && $inv['prices'][0]['amount'] === 250, 'stars invoice');
    $payload = $inv['payload'];
    $pcq = fn(array $o) => ['pre_checkout_query' => array_merge(['id' => 'q' . mt_rand(), 'from' => $from, 'currency' => 'XTR', 'total_amount' => 250, 'invoice_payload' => $payload], $o)];
    $hook($pcq([]));
    check($tg->last('answerPreCheckoutQuery')['ok'] === true, 'precheckout ok');
    $hook($pcq(['total_amount' => 1]));
    check($tg->last('answerPreCheckoutQuery')['ok'] === false, 'precheckout amount mismatch rejected');
    $paid = ['message' => ['message_id' => 9, 'chat' => $chat, 'from' => $from, 'successful_payment' => ['currency' => 'XTR', 'total_amount' => 250,
        'invoice_payload' => $payload, 'telegram_payment_charge_id' => 'charge_1']]];
    $hook($paid);
    $hook($paid);
    check((int) $app->db->one("SELECT count(*) n FROM payments WHERE provider_charge_id = 'charge_1'")['n'] === 1, 'payment recorded once');
    $wid = $app->listUserWorkspaces($app->db->one('SELECT id FROM users WHERE telegram_user_id = 5001')['id'])[0]['id'];
    check($app->access($wid)['state'] === 'subscribed', 'plan activated');
    $bad = $paid;
    $bad['message']['successful_payment']['telegram_payment_charge_id'] = 'charge_2';
    $bad['message']['successful_payment']['total_amount'] = 1;
    $hook($bad);
    check((int) $app->db->one("SELECT count(*) n FROM audit_logs WHERE action = 'payment.needs_review'")['n'] === 1, 'mismatch flagged');
    $tg->calls = [];
    for ($i = 0; $i < 40; $i++) $hook(['message' => ['message_id' => 1, 'chat' => $chat, 'from' => $from, 'text' => 'hi']]);
    check(count(array_filter($tg->calls, fn($c) => $c[0] === 'sendMessage')) <= 30, 'flood limited');
    $tg->calls = [];
    $hook(['message' => ['message_id' => 1, 'chat' => $chat, 'from' => ['id' => 42, 'is_bot' => true], 'text' => '/start']]);
    check($tg->calls === [], 'bots ignored');
});

suite('cron, health, 404', function () {
    [$app, $tg, $k] = harness();
    check(req($k, 'GET', '/cron', null, null, [], ['key' => 'nope'])['status'] === 404, 'cron key required');
    $r = req($k, 'GET', '/cron', null, null, [], ['key' => $app->cfg->cronKey()]);
    check($r['status'] === 200 && $r['json']['webhook'] === 'registered', 'cron registers webhook');
    $sw = $tg->last('setWebhook');
    check($sw['url'] === 'https://etebarami.test/God/tg/webhook' && $sw['secret_token'] === $app->cfg->webhookSecret, 'webhook url + secret');
    check(req($k, 'GET', '/readyz')['json']['db'] === 'up', 'readyz');
    check(req($k, 'GET', '/en/nope')['status'] === 404, '404');
    check(req($k, 'GET', '/en/home')['headers']['Location'] === '/God/en/', 'redirect keeps base path');
    check(str_contains(req($k, 'GET', '/en/status')['body'], 'operational'), 'status page');
    check(req($k, 'POST', '/api/v1/workspaces/00000000-0000-4000-8000-000000000000/ai/reply-suggestion', [], login($k, 77)['token'])['status'] === 404, 'ai route needs membership');
});

suite('bot connect (setup) endpoint', function () {
    [$app, , , $root] = harness(['TELEGRAM_BOT_TOKEN' => '']);
    $k = new Kernel($app, sys_get_temp_dir(), $root, fn(string $t) => (function () use ($t) {
        return new class ($t) implements TelegramApi {
            public function __construct(private string $t) {}
            public function call(string $method, array $params = []): mixed
            {
                if ($method === 'getMe') {
                    if (str_starts_with($this->t, '000')) throw new \RuntimeException('Unauthorized');
                    return ['username' => str_starts_with($this->t, '111') ? 'other_bot' : 'MLR_Test_Bot'];
                }
                return $method === 'getWebhookInfo' ? ['url' => ''] : true;
            }
        };
    })());
    check($app->cfg->botToken === null, 'starts without token');
    check(req($k, 'POST', '/setup/bot', ['token' => 'nonsense-token-value-123'])['status'] === 422, 'bad format rejected');
    check(req($k, 'POST', '/setup/bot', ['token' => '000000000:' . str_repeat('a', 35)])['status'] === 401, 'token rejected by telegram');
    check(req($k, 'POST', '/setup/bot', ['token' => '111111111:' . str_repeat('a', 35)])['status'] === 403, 'other bot rejected');
    check(!is_file($root . '/data/bot.php'), 'nothing stored on rejection');
    $ok = req($k, 'POST', '/setup/bot', ['token' => '222222222:' . str_repeat('b', 35)]);
    check($ok['status'] === 200 && $ok['json']['webhook'] === 'registered', 'correct bot connected + webhook');
    check(is_file($root . '/data/bot.php') && (fileperms($root . '/data/bot.php') & 0077) === 0, 'token stored privately');
    check(Config::load($root)->botToken === '222222222:' . str_repeat('b', 35), 'token loaded on next request');
    for ($i = 0; $i < 3; $i++) req($k, 'POST', '/setup/bot', ['token' => 'x']);
    check(req($k, 'POST', '/setup/bot', ['token' => 'x'])['status'] === 429, 'setup rate limited');
});

echo "\n# pass {$pass}\n# fail {$fail}\n";
exit($fail ? 1 : 0);
