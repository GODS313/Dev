<?php
declare(strict_types=1);

namespace App\Web;

use App\Connectors\Registry;
use App\Core\Audience;
use App\Core\Audit;
use App\Core\Auth;
use App\Core\Campaigns;
use App\Core\Channels;
use App\Core\Config;
use App\Core\Database;
use App\Core\Devices;
use App\Core\Sessions;
use App\Core\Worker;

final class App
{
    private ?array $admin = null;
    private string $token = '';

    public function handle(Request $req): Response
    {
        try {
            Auth::seedAdmin();
            return $this->route($req);
        } catch (\Throwable $e) {
            error_log('[platform] ' . $e);
            $key = $req->input('key');
            if ($key !== '' && hash_equals(Worker::cronKey(), $key)) {
                // Deploy pipeline diagnostics; the key is only known to the pipeline.
                return Response::json(['ok' => false, 'detail' => get_class($e) . ': ' . $e->getMessage()
                    . ' @ ' . basename($e->getFile()) . ':' . $e->getLine() . ' | php ' . PHP_VERSION
                    . ' | pdo_sqlite ' . (extension_loaded('pdo_sqlite') ? 'yes' : 'no')
                    . ' | storage writable ' . (is_writable(Config::storagePath()) ? 'yes' : 'no')], 500);
            }
            return str_starts_with($req->path, '/api/') || str_starts_with($req->path, '/hook/')
                ? Response::json(['ok' => false, 'error' => 'server error'], 500)
                : Response::html(View::render('error', ['message' => 'خطای داخلی سرور. جزئیات در لاگ سرور ثبت شد.']), 500);
        }
    }

    private function route(Request $req): Response
    {
        $m = $req->method;
        $p = $req->path;

        if ($p === '/') {
            return Response::redirect('/admin');
        }
        if ($p === '/health') {
            try {
                Database::scalar('SELECT 1');
            } catch (\Throwable $e) {
                // Details only for callers holding the worker key (the deploy pipeline).
                $detail = hash_equals(Worker::cronKey(), $req->input('key'))
                    ? get_class($e) . ': ' . $e->getMessage() . ' | php ' . PHP_VERSION . ' | sqlite ' . (extension_loaded('pdo_sqlite') ? 'yes' : 'no')
                    : null;
                return Response::json(['ok' => false, 'db' => 'error', 'detail' => $detail], 500);
            }
            $last = @file_get_contents(Config::storagePath('worker.last')) ?: null;
            return Response::json(['ok' => true, 'db' => 'ok', 'worker_last_run' => $last, 'time' => gmdate('c')]);
        }
        if (preg_match('#^/hook/(\d+)/([A-Za-z0-9_-]+)$#', $p, $mm) && $m === 'POST') {
            return $this->webhook($req, (int) $mm[1], $mm[2]);
        }
        if ($p === '/cron') {
            if (!hash_equals(Worker::cronKey(), $req->input('key'))) {
                return Response::json(['ok' => false], 403);
            }
            return Response::json(['ok' => true, 'result' => Worker::tick(25)]);
        }
        if (str_starts_with($p, '/api/v1/')) {
            return $this->api($req, substr($p, 7));
        }
        if ($p === '/admin/login') {
            return $m === 'POST' ? $this->login($req) : Response::html(View::render('login', ['error' => null]));
        }
        if (str_starts_with($p, '/admin')) {
            $this->token = (string) ($req->cookies[Auth::COOKIE] ?? '');
            $this->admin = Auth::current($this->token);
            if ($this->admin === null) {
                return Response::redirect('/admin/login');
            }
            if ($m === 'POST' && !hash_equals(Auth::csrf($this->token), $req->input('_csrf'))) {
                return Response::html(View::render('error', ['message' => 'نشست منقضی شده؛ صفحه را دوباره باز کنید.']), 419);
            }
            return $this->admin($req, substr($p, 6) ?: '/');
        }
        return Response::html(View::render('error', ['message' => 'صفحه پیدا نشد.']), 404);
    }

    private function login(Request $req): Response
    {
        if (Auth::throttled($req->ip)) {
            return Response::html(View::render('login', ['error' => 'تلاش‌های ناموفق زیاد بود؛ ۱۵ دقیقه دیگر امتحان کنید.']), 429);
        }
        $token = Auth::attempt($req->input('username'), (string) ($req->post['password'] ?? ''), $req->ip, $req->headers['user-agent'] ?? '');
        if ($token === null) {
            return Response::html(View::render('login', ['error' => 'نام کاربری یا رمز عبور اشتباه است.']), 401);
        }
        $r = Response::redirect('/admin');
        $r->cookies[Auth::COOKIE] = [$token, Auth::ttl()];
        return $r;
    }

    private function page(string $view, array $data = [], ?Request $req = null): Response
    {
        $flash = $req?->cookies['mp_flash'] ?? null;
        $r = Response::html(View::render($view, $data + [
            'admin' => $this->admin,
            'csrf' => Auth::csrf($this->token),
            'flash' => is_string($flash) ? $flash : null,
        ]));
        if ($flash !== null) {
            $r->cookies['mp_flash'] = ['', 0];
        }
        return $r;
    }

    private function admin(Request $req, string $p): Response
    {
        $m = $req->method;
        $actor = $this->admin['username'];
        $post = $m === 'POST';

        if ($p === '/' && !$post) {
            return $this->page('dashboard', ['stats' => [
                'users' => (int) Database::scalar('SELECT COUNT(*) FROM users'),
                'subscribed' => (int) Database::scalar('SELECT COUNT(*) FROM identities WHERE subscribed = 1'),
                'devices' => (int) Database::scalar('SELECT COUNT(*) FROM devices'),
                'sessions' => count(Sessions::active()),
                'connectors' => (int) Database::scalar('SELECT COUNT(*) FROM connectors WHERE enabled = 1'),
                'campaigns' => (int) Database::scalar("SELECT COUNT(*) FROM campaigns WHERE status IN ('running','scheduled')"),
                'sent' => (int) Database::scalar("SELECT COUNT(*) FROM deliveries WHERE status = 'sent'"),
                'worker' => @file_get_contents(Config::storagePath('worker.last')) ?: null,
            ], 'cronUrl' => $req->baseUrl() . '/cron?key=' . Worker::cronKey(), 'weak' => Auth::weakPassword((int) $this->admin['id'])], $req);
        }
        if ($p === '/logout' && $post) {
            Sessions::revokeToken($this->token);
            $r = Response::redirect('/admin/login');
            $r->cookies[Auth::COOKIE] = ['', 0];
            return $r;
        }

        // Users
        if ($p === '/users' && !$post) {
            return $this->page('users', ['users' => Audience::users($req->input('q')), 'q' => $req->input('q')], $req);
        }
        if ($p === '/users' && $post) {
            Audience::createUser($req->input('name'), $req->input('phone') ?: null, $req->input('email') ?: null, $req->input('tags'), $req->input('consent') === '1');
            Audit::log($actor, 'user_create', $req->input('name'), $req->ip);
            return Response::redirect('/admin/users', 'کاربر افزوده شد');
        }
        if ($p === '/users/import' && $post) {
            $text = (string) ($req->post['contacts'] ?? '');
            if (trim($text) === '') {
                return Response::redirect('/admin/users', 'متنی برای ورود داده نشد');
            }
            $res = Audience::importContacts($text, $req->input('consent') === '1');
            Audit::log($actor, 'user_import', 'added ' . $res['added'] . ' skipped ' . $res['skipped'], $req->ip);
            return Response::redirect('/admin/users', $res['added'] . ' مخاطب افزوده شد، ' . $res['skipped'] . ' مورد رد شد');
        }
        if (preg_match('#^/users/(\d+)/tags$#', $p, $mm) && $post) {
            Audience::updateTags((int) $mm[1], $req->input('tags'));
            return Response::redirect('/admin/users', 'برچسب‌ها ذخیره شد');
        }
        if (preg_match('#^/users/(\d+)/delete$#', $p, $mm) && $post) {
            Database::run('DELETE FROM users WHERE id = ?', [(int) $mm[1]]);
            Audit::log($actor, 'user_delete', $mm[1], $req->ip);
            return Response::redirect('/admin/users', 'کاربر حذف شد');
        }

        // Devices & sessions
        if ($p === '/devices' && !$post) {
            return $this->page('devices', ['devices' => Devices::all(), 'apiKey' => Devices::apiKey(), 'base' => $req->baseUrl()], $req);
        }
        if ($p === '/sessions' && !$post) {
            return $this->page('sessions', ['sessions' => Sessions::active(), 'current' => $this->admin['session_id']], $req);
        }
        if (preg_match('#^/sessions/(\d+)/revoke$#', $p, $mm) && $post) {
            Sessions::revoke((int) $mm[1]);
            Audit::log($actor, 'session_revoke', $mm[1], $req->ip);
            return Response::redirect('/admin/sessions', 'نشست لغو شد');
        }

        // Connectors
        if ($p === '/connectors' && !$post) {
            return $this->page('connectors', ['connectors' => Channels::all(), 'types' => Registry::all(), 'base' => $req->baseUrl(), 'secure' => $req->secure], $req);
        }
        if (preg_match('#^/connectors/(\d+)/business$#', $p, $mm) && $post) {
            Database::run('UPDATE connectors SET business_reply = ? WHERE id = ?', [trim((string) ($req->post['business_reply'] ?? '')) ?: null, (int) $mm[1]]);
            Audit::log($actor, 'connector_business', $mm[1], $req->ip);
            return Response::redirect('/admin/connectors', 'پاسخ خودکار ذخیره شد');
        }
        if (preg_match('#^/connectors/(\d+)/join$#', $p, $mm) && $post) {
            $row = Channels::find((int) $mm[1]);
            if ($row === null) {
                return Response::redirect('/admin/connectors', 'پیدا نشد');
            }
            $res = Channels::postJoinButton($row, (string) ($req->post['join_text'] ?? 'برای دریافت اطلاع‌رسانی‌ها عضو شوید:'), $req->input('button_text') ?: 'عضویت');
            Audit::log($actor, 'connector_join', $row['name'], $req->ip);
            return Response::redirect('/admin/connectors', !empty($res['ok']) ? 'پیام عضویت در ' . $res['sent'] . ' گروه/کانال ارسال شد' : 'خطا: نام کاربری ربات نامشخص است');
        }
        if ($p === '/connectors' && $post) {
            $res = Channels::create($req->input('type'), $req->input('name'), (string) ($req->post['secret'] ?? ''));
            Audit::log($actor, 'connector_create', $req->input('type') . ($res['ok'] ? ' ok' : ' failed'), $req->ip);
            if ($res['ok'] && $req->secure) {
                Channels::enableWebhook(Channels::find($res['id']), $req->baseUrl());
            }
            return Response::redirect('/admin/connectors', $res['ok'] ? 'کانکتور ' . $res['bot'] . ' متصل شد' : 'خطا: ' . $res['error']);
        }
        if (preg_match('#^/connectors/(\d+)/(webhook|polling|toggle|delete)$#', $p, $mm) && $post) {
            $row = Channels::find((int) $mm[1]);
            if ($row === null) {
                return Response::redirect('/admin/connectors', 'پیدا نشد');
            }
            $msg = 'انجام شد';
            if ($mm[2] === 'webhook') {
                $res = Channels::enableWebhook($row, $req->baseUrl());
                $msg = !empty($res['ok']) ? 'وب‌هوک فعال شد' : 'خطا: ' . ($res['description'] ?? 'نامشخص');
            } elseif ($mm[2] === 'polling') {
                Channels::disableWebhook($row);
                $msg = 'حالت دریافت با کران فعال شد';
            } elseif ($mm[2] === 'toggle') {
                Database::run('UPDATE connectors SET enabled = 1 - enabled WHERE id = ?', [$row['id']]);
            } else {
                Database::run('DELETE FROM connectors WHERE id = ?', [$row['id']]);
                $msg = 'کانکتور حذف شد';
            }
            Audit::log($actor, 'connector_' . $mm[2], $row['name'], $req->ip);
            return Response::redirect('/admin/connectors', $msg);
        }

        // Campaigns
        if ($p === '/campaigns' && !$post) {
            return $this->page('campaigns', ['campaigns' => Campaigns::all(), 'connectors' => Channels::all()], $req);
        }
        if ($p === '/campaigns' && $post) {
            $at = $req->input('scheduled_at');
            $id = Campaigns::create($req->input('name'), (int) $req->input('connector_id'), (string) ($req->post['message'] ?? ''), $req->input('tag'), $at !== '' ? date('Y-m-d H:i:s', strtotime($at)) : null, $req->input('audience'));
            Audit::log($actor, 'campaign_create', (string) $id, $req->ip);
            return Response::redirect('/admin/campaigns', 'کمپین ساخته شد (پیش‌نویس)');
        }
        if (preg_match('#^/campaigns/(\d+)/(start|pause|delete)$#', $p, $mm) && $post) {
            $id = (int) $mm[1];
            if ($mm[2] === 'start') {
                try {
                    $msg = Campaigns::start($id) === 'scheduled' ? 'کمپین زمان‌بندی شد' : 'ارسال کمپین آغاز شد';
                } catch (\RuntimeException $e) {
                    $msg = 'این کمپین در وضعیت فعلی قابل اجرا نیست';
                }
            } elseif ($mm[2] === 'pause') {
                Campaigns::pause($id);
                $msg = 'کمپین متوقف شد';
            } else {
                Database::run("DELETE FROM campaigns WHERE id = ? AND status <> 'running'", [$id]);
                $msg = 'کمپین حذف شد';
            }
            Audit::log($actor, 'campaign_' . $mm[2], (string) $id, $req->ip);
            return Response::redirect('/admin/campaigns', $msg);
        }

        // Tasks (modular automation)
        if ($p === '/tasks' && !$post) {
            return $this->page('tasks', [
                'tasks' => \App\Tasks\Registry::all(),
                'settings' => array_map(fn ($t) => \App\Tasks\Runner::settings($t->key()), \App\Tasks\Registry::all()),
                'runs' => array_map(fn ($t) => \App\Tasks\Runner::runs($t->key(), 15), \App\Tasks\Registry::all()),
            ], $req);
        }
        if (preg_match('#^/tasks/([a-z_]+)/settings$#', $p, $mm) && $post) {
            try {
                $task = \App\Tasks\Registry::get($mm[1]);
            } catch (\InvalidArgumentException $e) {
                return Response::redirect('/admin/tasks', 'وظیفه ناشناخته');
            }
            $secretField = $task->secretField();
            $secret = $secretField ? (string) ($req->post[$secretField] ?? '') : null;
            \App\Tasks\Runner::saveSettings($mm[1], $req->post, $secret, ($req->post['enabled'] ?? '') === '1');
            Audit::log($actor, 'task_settings', $mm[1], $req->ip);
            return Response::redirect('/admin/tasks', 'تنظیمات وظیفه ذخیره شد');
        }
        if (preg_match('#^/tasks/([a-z_]+)/run$#', $p, $mm) && $post) {
            if (!\App\Tasks\Runner::enabled($mm[1])) {
                return Response::redirect('/admin/tasks', 'این وظیفه غیرفعال است؛ اول فعالش کنید');
            }
            $s = \App\Tasks\Runner::settings($mm[1])['values'];
            $run = \App\Tasks\Runner::createRun($mm[1], (string) ($s['source_url'] ?? ''));
            $run = \App\Tasks\Runner::advance($run);
            Audit::log($actor, 'task_run', $mm[1] . ' #' . $run['id'] . ' ' . $run['status'], $req->ip);
            return Response::redirect('/admin/tasks', 'اجرا شد — وضعیت: ' . $run['status']);
        }

        if ($p === '/audit' && !$post) {
            return $this->page('audit', ['rows' => Audit::recent()], $req);
        }
        if ($p === '/account' && !$post) {
            return $this->page('account', [], $req);
        }
        if ($p === '/account' && $post) {
            $new = (string) ($req->post['new_password'] ?? '');
            $row = Database::one('SELECT password_hash FROM admins WHERE id = ?', [$this->admin['id']]);
            if (!password_verify((string) ($req->post['current_password'] ?? ''), $row['password_hash']) || strlen($new) < 10) {
                return Response::redirect('/admin/account', 'رمز فعلی اشتباه است یا رمز جدید کمتر از ۱۰ کاراکتر است');
            }
            Auth::setPassword((int) $this->admin['id'], $new);
            Audit::log($actor, 'password_change', null, $req->ip);
            $r = Response::redirect('/admin/login');
            $r->cookies[Auth::COOKIE] = ['', 0];
            return $r;
        }
        return Response::html(View::render('error', ['message' => 'صفحه پیدا نشد.']), 404);
    }

    private function webhook(Request $req, int $id, string $key): Response
    {
        $row = Channels::find($id);
        if ($row === null || !hash_equals($row['webhook_key'], $key)) {
            return Response::json(['ok' => false], 403);
        }
        $header = $req->headers['x-telegram-bot-api-secret-token'] ?? null;
        if ($header !== null && !hash_equals($row['webhook_key'], $header)) {
            return Response::json(['ok' => false], 403);
        }
        if ((int) $row['enabled'] === 1) {
            Channels::handleUpdate($row, $req->json());
        }
        return Response::json(['ok' => true]);
    }

    private function api(Request $req, string $p): Response
    {
        if ($p === '/devices/register' && $req->method === 'POST') {
            if (!hash_equals(Devices::apiKey(), $req->headers['x-api-key'] ?? '')) {
                return Response::json(['ok' => false, 'error' => 'invalid api key'], 401);
            }
            try {
                $out = Devices::register($req->json(), $req->ip, $req->headers['user-agent'] ?? '');
            } catch (\InvalidArgumentException $e) {
                return Response::json(['ok' => false, 'error' => $e->getMessage()], 422);
            }
            return Response::json(['ok' => true] + $out, 201);
        }
        if ($p === '/devices/heartbeat' && $req->method === 'POST') {
            $session = Sessions::validate($req->bearer(), 'device');
            if ($session === null) {
                return Response::json(['ok' => false, 'error' => 'invalid session'], 401);
            }
            Devices::heartbeat($session, $req->ip);
            return Response::json(['ok' => true]);
        }
        if ($p === '/devices/logout' && $req->method === 'POST') {
            Sessions::revokeToken($req->bearer());
            return Response::json(['ok' => true]);
        }
        return Response::json(['ok' => false, 'error' => 'not found'], 404);
    }
}
