<?php
declare(strict_types=1);

// Self-contained test suite: php platform/tests/run.php
$tmp = sys_get_temp_dir() . '/platform-test-' . bin2hex(random_bytes(4));
mkdir($tmp);
putenv('STORAGE_DIR=' . $tmp);
putenv('ADMIN_USER=admin');
putenv('ADMIN_PASSWORD=correct-horse-battery');
putenv('BASE_PATH=');
putenv('CRON_KEY=');
putenv('DB_DSN=');

require dirname(__DIR__) . '/app/bootstrap.php';

use App\Connectors\BotApiConnector;
use App\Core\Audience;
use App\Core\Campaigns;
use App\Core\Channels;
use App\Core\Crypto;
use App\Core\Database;
use App\Core\Devices;
use App\Core\Sessions;
use App\Web\App;
use App\Web\Request;

$failures = 0;
$count = 0;
function check(bool $cond, string $label): void
{
    global $failures, $count;
    $count++;
    if (!$cond) {
        $failures++;
        echo "FAIL: $label\n";
    }
}

// Fake Bot API: records calls; chat 999 has blocked the bot.
$calls = [];
BotApiConnector::$transport = static function (string $url, array $params) use (&$calls): array {
    $method = substr($url, strrpos($url, '/') + 1);
    $calls[] = [$method, $params, $url];
    if (str_contains($url, 'botBAD')) {
        return ['ok' => false, 'error_code' => 401, 'description' => 'Unauthorized'];
    }
    return match ($method) {
        'getMe' => ['ok' => true, 'result' => ['username' => 'demo_bot']],
        'sendMessage' => ($params['chat_id'] ?? '') === '999'
            ? ['ok' => false, 'error_code' => 403, 'description' => 'Forbidden: bot was blocked by the user']
            : ['ok' => true, 'result' => ['message_id' => 1]],
        'getUpdates' => ['ok' => true, 'result' => [
            ['update_id' => 50, 'message' => ['chat' => ['id' => 777, 'type' => 'private'], 'from' => ['first_name' => 'Poll'], 'text' => '/start']],
        ]],
        default => ['ok' => true, 'result' => true],
    };
};

$app = new App();
function req(string $method, string $path, array $post = [], array $cookies = [], array $headers = [], string $body = ''): Request
{
    return new Request($method, $path, [], $post, $cookies, $headers, $body, '10.0.0.1', true, 'panel.test');
}

// Crypto
check(Crypto::decrypt(Crypto::encrypt('secret-ä')) === 'secret-ä', 'crypto roundtrip');

// Health + auth
$r = $app->handle(req('GET', '/health'));
check($r->status === 200 && json_decode($r->body, true)['ok'] === true, 'health ok');
check($app->handle(req('GET', '/admin'))->headers['Location'] === '/admin/login', 'admin requires login');
check($app->handle(req('POST', '/admin/login', ['username' => 'admin', 'password' => 'wrong']))->status === 401, 'bad password rejected');
$r = $app->handle(req('POST', '/admin/login', ['username' => 'admin', 'password' => 'correct-horse-battery']));
check($r->status === 303 && isset($r->cookies['mp_session']), 'login sets session');
$token = $r->cookies['mp_session'][0];
$cookies = ['mp_session' => $token];
$csrf = \App\Core\Auth::csrf($token);
check($app->handle(req('GET', '/admin', [], $cookies))->status === 200, 'dashboard renders');
foreach (['/admin/users', '/admin/devices', '/admin/sessions', '/admin/connectors', '/admin/campaigns', '/admin/audit', '/admin/account'] as $page) {
    check($app->handle(req('GET', $page, [], $cookies))->status === 200, "page $page renders");
}
check($app->handle(req('POST', '/admin/users', ['name' => 'x'], $cookies))->status === 419, 'csrf enforced');

// Connectors
$r = $app->handle(req('POST', '/admin/connectors', ['_csrf' => $csrf, 'type' => 'telegram', 'name' => '', 'secret' => 'BAD'], $cookies));
check(str_contains($r->cookies['mp_flash'][0], 'Unauthorized'), 'invalid token rejected');
check((int) Database::scalar('SELECT COUNT(*) FROM connectors') === 0, 'no connector saved on failure');
$app->handle(req('POST', '/admin/connectors', ['_csrf' => $csrf, 'type' => 'telegram', 'name' => '', 'secret' => '123:ABC'], $cookies));
$conn = Channels::find(1);
check($conn !== null && $conn['name'] === '@demo_bot', 'connector created');
check(!str_contains($conn['secret_enc'], '123:ABC') && Channels::secret($conn) === '123:ABC', 'token encrypted at rest');
check((int) $conn['webhook_active'] === 1, 'webhook enabled on https');
$hook = array_values(array_filter($calls, fn ($c) => $c[0] === 'setWebhook'))[0][1];
check($hook['url'] === 'https://panel.test/hook/1/' . $conn['webhook_key'] && $hook['secret_token'] === $conn['webhook_key'], 'webhook url and secret');
$app->handle(req('POST', '/admin/connectors', ['_csrf' => $csrf, 'type' => 'bale', 'name' => 'بله', 'secret' => '9:XYZ'], $cookies));
check(str_contains(end($calls)[2], 'tapi.bale.ai'), 'bale uses its own api');
check(!isset(end($calls)[1]['secret_token']), 'bale webhook without secret header');

// Webhook inbound: opt-in / opt-out
$update = fn (int $chat, string $text, int $uid) => json_encode(['update_id' => $uid, 'message' => ['chat' => ['id' => $chat, 'type' => 'private'], 'from' => ['first_name' => 'U' . $chat, 'username' => 'u' . $chat], 'text' => $text]]);
$hdr = ['x-telegram-bot-api-secret-token' => $conn['webhook_key']];
check($app->handle(req('POST', '/hook/1/wrong', [], [], [], $update(1, '/start', 1)))->status === 403, 'webhook key checked');
check($app->handle(req('POST', '/hook/1/' . $conn['webhook_key'], [], [], ['x-telegram-bot-api-secret-token' => 'nope'], $update(1, '/start', 1)))->status === 403, 'webhook header checked');
foreach ([[101, '/start', 10], [102, '/start', 11], [999, '/start', 12], [103, 'hello', 13], [102, '/stop', 14]] as [$chat, $text, $uid]) {
    $app->handle(req('POST', '/hook/1/' . $conn['webhook_key'], [], [], $hdr, $update($chat, $text, $uid)));
}
$subs = Database::all('SELECT external_id FROM identities WHERE connector_id = 1 AND subscribed = 1 ORDER BY external_id');
check(array_column($subs, 'external_id') === ['101', '999'], 'only /start users subscribed; /stop removes');
check((int) Database::scalar('SELECT COUNT(*) FROM identities') === 4, 'non-command sender still registered');
check((int) Database::scalar('SELECT last_update_id FROM connectors WHERE id = 1') === 14, 'update offset tracked');

// Tags + campaign
$uid101 = (int) Database::scalar("SELECT user_id FROM identities WHERE external_id = '101'");
Audience::updateTags($uid101, 'VIP، تهران');
check(Database::scalar('SELECT tags FROM users WHERE id = ?', [$uid101]) === 'vip,تهران', 'tags normalized');
$app->handle(req('POST', '/admin/campaigns', ['_csrf' => $csrf, 'name' => 'c1', 'connector_id' => '1', 'message' => 'تخفیف ویژه', 'tag' => '', 'scheduled_at' => ''], $cookies));
$app->handle(req('POST', '/admin/campaigns/1/start', ['_csrf' => $csrf], $cookies));
check(Campaigns::find(1)['status'] === 'running', 'campaign running');
$calls = [];
$stats = Campaigns::dispatch(50, 0);
check($stats['sent'] === 1 && $stats['failed'] === 1, 'dispatch sent 1, failed 1 (blocked)');
check(str_contains($calls[0][1]['text'], '/stop'), 'opt-out footer appended');
check((int) Database::scalar("SELECT subscribed FROM identities WHERE external_id = '999'") === 0, 'blocked user unsubscribed');
check(Campaigns::find(1)['status'] === 'done', 'campaign finished');
check(Campaigns::dispatch(50, 0)['sent'] === 0, 'no duplicate sends');

$c2 = Campaigns::create('tagged', 1, 'vip only', 'vip', null);
Campaigns::start($c2);
check((int) Database::scalar('SELECT COUNT(*) FROM deliveries WHERE campaign_id = ?', [$c2]) === 1, 'tag filter targets vip');
Campaigns::pause($c2);
check(Campaigns::dispatch(50, 0)['sent'] === 0, 'paused campaign does not send');
$c3 = Campaigns::create('later', 1, 'soon', '', date('Y-m-d H:i:s', time() + 3600));
check(Campaigns::start($c3) === 'scheduled', 'future campaign scheduled');
check(Campaigns::dispatch(50, 0)['launched'] === 0, 'scheduled not launched early');
Database::run('UPDATE campaigns SET scheduled_at = ? WHERE id = ?', [date('Y-m-d H:i:s', time() - 5), $c3]);
check(Campaigns::dispatch(50, 0)['launched'] === 1, 'due campaign launched');

// Polling fallback
Channels::disableWebhook(Channels::find(1));
check(Channels::poll(Channels::find(1)) === 1, 'polling fetched update');
check((int) Database::scalar("SELECT subscribed FROM identities WHERE external_id = '777'") === 1, 'polled /start subscribed');

// Devices + device sessions
check($app->handle(req('POST', '/api/v1/devices/register', [], [], ['x-api-key' => 'nope'], '{}'))->status === 401, 'device api key required');
$r = $app->handle(req('POST', '/api/v1/devices/register', [], [], ['x-api-key' => Devices::apiKey()], json_encode(['device_uid' => 'abc', 'platform' => 'android'])));
$dev = json_decode($r->body, true);
check($r->status === 201 && !empty($dev['token']), 'device registered');
check($app->handle(req('POST', '/api/v1/devices/heartbeat', [], [], ['authorization' => 'Bearer ' . $dev['token']]))->status === 200, 'heartbeat ok');
$r2 = json_decode($app->handle(req('POST', '/api/v1/devices/register', [], [], ['x-api-key' => Devices::apiKey()], json_encode(['device_uid' => 'abc'])))->body, true);
check($app->handle(req('POST', '/api/v1/devices/heartbeat', [], [], ['authorization' => 'Bearer ' . $dev['token']]))->status === 401, 're-register revokes old device session');
check((int) Database::scalar('SELECT COUNT(*) FROM devices') === 1, 'device upserted');

// Session revocation + logout
$sid = (int) Database::scalar("SELECT id FROM sessions WHERE subject_type = 'device' AND revoked_at IS NULL");
$app->handle(req('POST', "/admin/sessions/$sid/revoke", ['_csrf' => $csrf], $cookies));
check($app->handle(req('POST', '/api/v1/devices/heartbeat', [], [], ['authorization' => 'Bearer ' . $r2['token']]))->status === 401, 'admin can revoke device session');
$app->handle(req('POST', '/admin/logout', ['_csrf' => $csrf], $cookies));
check($app->handle(req('GET', '/admin', [], $cookies))->status === 303, 'logout revokes session');

// Throttling
for ($i = 0; $i < 9; $i++) {
    $r = $app->handle(req('POST', '/admin/login', ['username' => 'admin', 'password' => 'x']));
}
check($r->status === 429, 'login throttled');

// Worker tick
$tick = \App\Core\Worker::tick(5);
check(is_array($tick) && $tick['errors'] === [], 'worker tick runs');

echo "$count checks, $failures failed\n";
array_map('unlink', glob("$tmp/*") ?: []);
@rmdir($tmp);
exit($failures === 0 ? 0 : 1);
