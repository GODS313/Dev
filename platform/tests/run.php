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

// Short bootstrap password is accepted and flagged
putenv('ADMIN_PASSWORD=short1');
\App\Core\Auth::seedAdmin();
check(\App\Core\Auth::weakPassword(1), 'short bootstrap password flagged');
putenv('ADMIN_PASSWORD=correct-horse-battery');
Database::run('DELETE FROM admins');
\App\Core\Auth::seedAdmin();
check(!\App\Core\Auth::weakPassword((int) Database::scalar('SELECT id FROM admins')), 'strong password not flagged');

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

// Bot username captured at connect time
check(Channels::find(1)['bot_username'] === 'demo_bot', 'bot username stored');

// CSV bulk import of the operator's own contacts
$csv = "name,phone,tags\nعلی رضایی,0912-111-1111,vip\nسارا,۰۹۱۲۲۲۲۲۲۲۲,تهران\nعلی رضایی,09121111111,dup\n,,\n";
$imp = Audience::importContacts($csv, true);
check($imp['added'] === 2 && $imp['skipped'] === 2, 'csv import adds 2, skips dup+empty');
check((int) Database::scalar("SELECT COUNT(*) FROM users WHERE phone = '09121111111'") === 1, 'phone normalized and de-duplicated');
check(count(Audience::users('رضایی')) === 1, 'fast search finds imported contact by name');
check(count(Audience::users('0912222')) === 1, 'fast search finds by normalized phone');

// Group/channel membership + group campaign
$member = fn (int $chat, string $status, string $title, int $uid) => json_encode(['update_id' => $uid, 'my_chat_member' => ['chat' => ['id' => $chat, 'type' => 'supergroup', 'title' => $title], 'new_chat_member' => ['status' => $status]]]);
$app->handle(req('POST', '/hook/1/' . $conn['webhook_key'], [], [], $hdr, $member(-100200, 'administrator', 'گروه فروش', 20)));
$app->handle(req('POST', '/hook/1/' . $conn['webhook_key'], [], [], $hdr, $member(-100300, 'member', 'کانال خبر', 21)));
check(count(Audience::chats(1)) === 2, 'two group/channel chats registered');
check(!in_array('-100200', array_map(fn ($id) => (string) Database::scalar('SELECT external_id FROM identities WHERE id = ?', [$id]), Audience::reachable(1, '', 'subscribers')), true), 'groups excluded from private audience');
check(count(Audience::reachable(1, '', 'groups')) === 2, 'group audience targets both chats');
$app->handle(req('POST', '/hook/1/' . $conn['webhook_key'], [], [], $hdr, $member(-100300, 'left', 'کانال خبر', 22)));
check(count(Audience::reachable(1, '', 'groups')) === 1, 'bot removed from a chat drops it');

$calls = [];
$gc = Campaigns::create('اطلاعیه', 1, 'سلام گروه', '', null, 'groups');
Campaigns::start($gc);
$gstats = Campaigns::dispatch(50, 0);
check($gstats['sent'] === 1, 'group campaign posts to the remaining chat');
check(!str_contains($calls[0][1]['text'], '/stop'), 'group post has no opt-out footer');
check($calls[0][1]['chat_id'] === '-100200', 'group post targets the group chat id');

// Join button posted into groups/channels
$calls = [];
$jres = Channels::postJoinButton(Channels::find(1), 'عضو شوید', 'عضویت');
check($jres['ok'] && $jres['sent'] === 1, 'join button posted to one chat');
check(isset($calls[0][1]['reply_markup']['inline_keyboard'][0][0]['url']) && str_contains($calls[0][1]['reply_markup']['inline_keyboard'][0][0]['url'], 'demo_bot?start=join'), 'join button carries start link');

// Business auto-reply: once per day, only when configured
Database::run("UPDATE connectors SET business_reply = 'ممنون از پیام شما، به‌زودی پاسخ می‌دهیم.' WHERE id = 1");
$conn = Channels::find(1);
$biz = fn (int $chat, int $uid) => json_encode(['update_id' => $uid, 'business_message' => ['business_connection_id' => 'bconn1', 'chat' => ['id' => $chat, 'type' => 'private'], 'from' => ['first_name' => 'C'], 'text' => 'سلام']]);
$calls = [];
$app->handle(req('POST', '/hook/1/' . $conn['webhook_key'], [], [], $hdr, $biz(555, 30)));
check(count($calls) === 1 && ($calls[0][1]['business_connection_id'] ?? '') === 'bconn1', 'business message gets one auto-reply with connection id');
$app->handle(req('POST', '/hook/1/' . $conn['webhook_key'], [], [], $hdr, $biz(555, 31)));
check(count($calls) === 1, 'business auto-reply not repeated same day');
check((int) Database::scalar("SELECT COUNT(*) FROM identities WHERE external_id = '555'") === 0, 'business sender is not added to the audience');

// ---- Tasks: Build APK publish ----
$apkBytes = "PK\x03\x04" . str_repeat("\x00", 2000);
$published = null;
\App\Core\Http::$transport = function (string $method, string $url, array $opts) use ($apkBytes, &$published) {
    if ($method === 'GET' && str_contains($url, 'source')) {
        return ['ok' => true, 'status' => 200, 'body' => $apkBytes, 'headers' => [], 'error' => null];
    }
    if ($method === 'GET' && str_contains($url, 'notapk')) {
        return ['ok' => true, 'status' => 200, 'body' => 'not-an-apk', 'headers' => [], 'error' => null];
    }
    if ($method === 'POST' && str_contains($url, 'publish')) {
        // Verify the signature the task computed, like the real /x/ endpoint would.
        $secret = 'shared-build-secret';
        $ts = $opts['headers']['X-Timestamp'];
        $name = rawurldecode($opts['headers']['X-App-Name']);
        $ver = rawurldecode($opts['headers']['X-App-Version']);
        $hash = hash('sha256', $opts['body']);
        $expected = hash_hmac('sha256', "$ts\n$name\n$ver\n$hash", $secret);
        $okSig = hash_equals($expected, $opts['headers']['X-Signature']) && $hash === $opts['headers']['X-Content-Sha256'];
        if (!$okSig) {
            return ['ok' => false, 'status' => 401, 'body' => '{"ok":false,"error":"bad signature"}', 'headers' => [], 'error' => null];
        }
        $published = ['name' => $name, 'version' => $ver, 'size' => strlen($opts['body'])];
        return ['ok' => true, 'status' => 200, 'body' => json_encode(['ok' => true, 'url' => 'https://etebarami.net/x/releases/' . $name . '-' . $ver . '.apk']), 'headers' => [], 'error' => null];
    }
    return ['ok' => false, 'status' => 404, 'body' => '', 'headers' => [], 'error' => 'unexpected'];
};

// Settings save + secret encryption + default app name
\App\Tasks\Runner::saveSettings('build_apk', [
    'app_name' => 'iLiveX',
    'source_url' => 'https://build.example/source/app.apk',
    'publish_url' => 'https://etebarami.net/x/publish.php',
    'version' => '1.0',
    'delivery_connector_id' => '1',
    'delivery_chat_id' => '-100200',
], 'shared-build-secret', true);
$ts = \App\Tasks\Runner::settings('build_apk');
check($ts['enabled'] === true && $ts['values']['app_name'] === 'iLiveX', 'task settings saved');
check($ts['has_secret'] === true, 'task reports stored secret');
check(\App\Tasks\Runner::secret('build_apk') === 'shared-build-secret', 'task secret decrypts');
check(Database::scalar("SELECT secret_enc FROM task_settings WHERE task_key='build_apk'") !== 'shared-build-secret', 'task secret encrypted at rest');

// Full run: fetch -> publish -> deliver
$calls = [];
$run = \App\Tasks\Runner::createRun('build_apk', 'https://build.example/source/app.apk');
$run = \App\Tasks\Runner::advance($run);
check($run['status'] === 'done', 'build task reaches done');
check($published !== null && $published['name'] === 'iLiveX' && $published['version'] === '1.0', 'apk published with signed metadata');
check(str_contains((string) $run['result'], '/x/releases/'), 'run stores published url');
check(count(array_filter($calls, fn ($c) => $c[0] === 'sendMessage' && $c[1]['chat_id'] === '-100200')) === 1, 'link delivered to configured chat');

// Dedup: same file is not re-published
$run2 = \App\Tasks\Runner::advance(\App\Tasks\Runner::createRun('build_apk', 'https://build.example/source/app.apk'));
check($run2['status'] === 'skipped', 'identical apk is skipped');

// Invalid source is a clean failure, not a guess
Database::run("UPDATE task_settings SET settings_json = ? WHERE task_key='build_apk'", [json_encode(['app_name' => 'iLiveX', 'source_url' => 'https://build.example/notapk', 'publish_url' => 'https://etebarami.net/x/publish.php'])]);
$run3 = \App\Tasks\Runner::advance(\App\Tasks\Runner::createRun('build_apk', 'x'));
check($run3['status'] === 'failed', 'non-apk source fails cleanly');

// Logs never store the secret
$allLogs = implode(' ', array_column(Database::all('SELECT log_json FROM task_runs'), 'log_json'));
check(!str_contains($allLogs, 'shared-build-secret'), 'secret never written to run logs');

// Direct APK upload -> auto publish (for build services that hand back a file, not a link)
\App\Tasks\Runner::saveSettings('build_apk', [
    'app_name' => 'iLiveX', 'source_url' => '', 'publish_url' => 'https://etebarami.net/x/publish.php',
    'version' => '3.0', 'delivery_connector_id' => '', 'delivery_chat_id' => '',
], null, true);
$apk2 = "PK\x03\x04" . str_repeat("\x01", 2500);
$uploadReq = new Request('POST', '/admin/tasks/build_apk/upload', [], ['_csrf' => $csrf], $cookies, [], '', '10.0.0.1', true, 'panel.test', ['apk' => ['bytes' => $apk2]]);
$published = null;
$flash = $app->handle($uploadReq)->cookies['mp_flash'][0] ?? '';
check(str_contains($flash, 'منتشر شد'), 'uploaded apk publishes');
check($published !== null && $published['version'] === '3.0', 'upload published with configured version');
check((int) Database::scalar("SELECT COUNT(*) FROM task_runs WHERE ref = ? AND status = 'done'", [hash('sha256', $apk2)]) === 1, 'upload run recorded as done');
$dupReq = new Request('POST', '/admin/tasks/build_apk/upload', [], ['_csrf' => $csrf], $cookies, [], '', '10.0.0.1', true, 'panel.test', ['apk' => ['bytes' => $apk2]]);
check(str_contains($app->handle($dupReq)->cookies['mp_flash'][0] ?? '', 'قبلاً منتشر'), 'duplicate upload rejected');
$badReq = new Request('POST', '/admin/tasks/build_apk/upload', [], ['_csrf' => $csrf], $cookies, [], '', '10.0.0.1', true, 'panel.test', ['apk' => ['bytes' => 'nope']]);
check(str_contains($app->handle($badReq)->cookies['mp_flash'][0] ?? '', 'معتبر'), 'non-apk upload rejected');

// Panel pages + gated run
$app->handle(req('POST', '/admin/logout', ['_csrf' => \App\Core\Auth::csrf($token)], $cookies));
$token = $app->handle(req('POST', '/admin/login', ['username' => 'admin', 'password' => 'correct-horse-battery']))->cookies['mp_session'][0];
$cookies = ['mp_session' => $token];
$csrf = \App\Core\Auth::csrf($token);
check($app->handle(req('GET', '/admin/tasks', [], $cookies))->status === 200, 'tasks page renders');
Database::run("UPDATE task_settings SET enabled = 0 WHERE task_key='build_apk'");
$flash = $app->handle(req('POST', '/admin/tasks/build_apk/run', ['_csrf' => $csrf], $cookies))->cookies['mp_flash'][0] ?? '';
check(str_contains($flash, 'غیرفعال'), 'disabled task refuses to run');

\App\Core\Http::$transport = null;

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
$rmrf = function (string $path) use (&$rmrf): void {
    foreach (glob($path . '/*') ?: [] as $child) {
        is_dir($child) ? $rmrf($child) : @unlink($child);
    }
    @rmdir($path);
};
$rmrf($tmp);
exit($failures === 0 ? 0 : 1);
