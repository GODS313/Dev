<?php
declare(strict_types=1);

namespace Mlr;

/** Telegram bot (webhook). Port of apps/server/src/bot/bot.ts for shared hosting. */
final class Bot
{
    private array $user = [];
    private string $locale = 'en';

    public function __construct(private App $app)
    {
    }

    private function t(string $key, array $vars = []): string
    {
        return I18n::t($this->locale, $key, $vars);
    }

    private function call(string $method, array $params): mixed
    {
        return $this->app->tg->call($method, $params);
    }

    private function send(int $chat, string $text, ?array $kb = null): void
    {
        $p = ['chat_id' => $chat, 'text' => $text, 'parse_mode' => 'HTML', 'link_preview_options' => ['is_disabled' => true]];
        if ($kb) $p['reply_markup'] = ['inline_keyboard' => $kb];
        $this->call('sendMessage', $p);
    }

    private function edit(array $msg, string $text, ?array $kb = null): void
    {
        $p = ['chat_id' => $msg['chat']['id'], 'message_id' => $msg['message_id'], 'text' => $text, 'parse_mode' => 'HTML'];
        if ($kb) $p['reply_markup'] = ['inline_keyboard' => $kb];
        try {
            $this->call('editMessageText', $p);
        } catch (\Throwable) {
            $this->send((int) $msg['chat']['id'], $text, $kb); // e.g. message too old to edit
        }
    }

    private function appBtn(string $text, string $q = ''): array
    {
        return ['text' => $text, 'web_app' => ['url' => $this->app->miniAppUrl($q)]];
    }

    private function btn(string $text, string $data): array
    {
        return ['text' => $text, 'callback_data' => $data];
    }

    private function mainMenu(bool $hasWs): array
    {
        $kb = [[$this->appBtn($this->t('bot.btn.open_app'))]];
        $kb[] = $hasWs ? [$this->btn($this->t('bot.btn.my_business'), 'menu:business'), $this->btn($this->t('bot.btn.ai'), 'menu:ai')]
            : [$this->btn($this->t('bot.btn.start_trial'), 'trial:start')];
        $kb[] = [$this->btn($this->t('bot.btn.plans'), 'menu:plans'), $this->btn($this->t('bot.btn.support'), 'menu:support')];
        $kb[] = [$this->btn($this->t('bot.btn.invite'), 'menu:invite'), $this->btn($this->t('bot.btn.settings'), 'menu:settings')];
        return $kb;
    }

    private function back(): array
    {
        return [[$this->btn($this->t('bot.btn.back'), 'menu:main')]];
    }

    private function langKb(): array
    {
        return [[$this->btn('English', 'lang:en'), $this->btn('فارسی', 'lang:fa')]];
    }

    public function handle(array $update): void
    {
        $from = $update['message']['from'] ?? $update['callback_query']['from'] ?? $update['pre_checkout_query']['from'] ?? null;
        if (!$from || !empty($from['is_bot'])) return;
        try {
            $this->app->rateLimit('bot:' . $from['id'], 30, 60);
        } catch (AppError) {
            return; // drop floods silently
        }
        [$user, $isNew] = $this->app->upsertUser($from);
        $this->user = $user;
        $this->locale = $user['locale'];
        $chatType = $update['message']['chat']['type'] ?? $update['callback_query']['message']['chat']['type'] ?? 'private';
        if ($user['is_blocked']) {
            if (isset($update['message']) && $chatType === 'private') $this->send((int) $update['message']['chat']['id'], $this->t('bot.blocked'));
            return;
        }
        if ($isNew) {
            $text = (string) ($update['message']['text'] ?? '');
            $payload = str_starts_with($text, '/start') ? trim(substr($text, 6)) : '';
            $source = preg_match('/^src_([a-z0-9_]{1,32})$/', $payload, $mm) ? $mm[1] : (str_starts_with($payload, 'ref_') ? 'referral' : 'direct');
            $this->app->track('bot_started', $user['id'], null, ['source' => $source]);
            if (preg_match('/^ref_([a-z0-9]{6,16})$/', $payload, $mm)) {
                $ref = $this->app->db->one('SELECT user_id FROM referral_codes WHERE code = ?', [$mm[1]]);
                if ($ref && $ref['user_id'] !== $user['id']) {
                    $this->app->db->exec('UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL', [$ref['user_id'], $user['id']]);
                    $this->app->track('referral_signup', $user['id']);
                }
            }
        }
        if (isset($update['pre_checkout_query'])) {
            $q = $update['pre_checkout_query'];
            $reason = $this->app->preCheckout((string) $q['invoice_payload'], (string) $q['currency'], (int) $q['total_amount'], (int) $q['from']['id']);
            $this->call('answerPreCheckoutQuery', $reason === null ? ['pre_checkout_query_id' => $q['id'], 'ok' => true]
                : ['pre_checkout_query_id' => $q['id'], 'ok' => false, 'error_message' => $this->t('bot.precheckout_failed')]);
            return;
        }
        if (isset($update['callback_query'])) {
            $this->onCallback($update['callback_query']);
            return;
        }
        $msg = $update['message'] ?? null;
        if (!$msg || $chatType !== 'private') return;
        $chat = (int) $msg['chat']['id'];
        if (isset($msg['successful_payment'])) {
            $sp = $msg['successful_payment'];
            $out = $this->app->successfulPayment((string) $sp['invoice_payload'], (string) $sp['currency'], (int) $sp['total_amount'], (string) $sp['telegram_payment_charge_id']);
            if ($out['kind'] === 'activated') {
                $this->send($chat, $this->t('bot.payment_success', ['plan' => $out['plan'], 'date' => gmdate('Y-m-d', $out['periodEnd'])]));
            } elseif ($out['kind'] === 'needs_review') {
                $this->send($chat, $this->t('bot.payment_review', ['ref' => substr((string) $sp['telegram_payment_charge_id'], -10)]));
                foreach ($this->app->cfg->adminIds as $a) $this->app->notify((int) $a, '⚠️ Payment needs review: ' . $out['reason']);
            }
            return;
        }
        $text = trim((string) ($msg['text'] ?? ''));
        $cmd = strtolower(explode(' ', $text)[0]);
        $cmd = explode('@', $cmd)[0];
        switch ($cmd) {
            case '/start':
                $payload = trim(substr($text, 6));
                if (preg_match('/^store_([a-z0-9-]{3,40})$/', $payload, $mm)) {
                    $this->send($chat, '🛍', [[$this->appBtn('🛍 Open store', '?store=' . $mm[1])]]);
                    return;
                }
                if (!$user['locale_chosen']) {
                    $this->send($chat, $this->t('bot.choose_language'), $this->langKb());
                    return;
                }
                $this->sendMain($chat);
                return;
            case '/app':
                $this->send($chat, '📱', [[$this->appBtn($this->t('bot.btn.open_app'))]]);
                return;
            case '/plans':
                $this->sendPlans(null, $chat);
                return;
            case '/support':
                $this->send($chat, $this->t('bot.support_intro'), [[$this->appBtn($this->t('bot.btn.open_app'), '?p=support')]]);
                return;
            case '/language':
                $this->send($chat, $this->t('bot.choose_language'), $this->langKb());
                return;
            case '/help':
                $this->send($chat, $this->t('bot.help'));
                return;
            case '/privacy':
                $this->send($chat, $this->t('bot.privacy', ['link' => "{$this->app->cfg->baseUrl}/{$this->locale}/privacy"]));
                return;
        }
        $this->send($chat, $this->t('bot.unknown'), $this->mainMenu((bool) $this->app->listUserWorkspaces($user['id'])));
    }

    private function sendMain(int $chat, ?array $editMsg = null): void
    {
        $ws = $this->app->listUserWorkspaces($this->user['id']);
        $text = $ws ? $this->t('bot.welcome_back', ['name' => htmlspecialchars($this->user['first_name'] ?: '🙂')]) : $this->t('bot.welcome');
        $editMsg ? $this->edit($editMsg, $text, $this->mainMenu((bool) $ws)) : $this->send($chat, $text, $this->mainMenu((bool) $ws));
    }

    private function sendPlans(?array $editMsg, int $chat): void
    {
        $lines = [];
        $kb = [];
        foreach ($this->app->plans() as $p) {
            $lines[] = $this->t('bot.plan_line', ['plan' => $p['code'], 'price' => $p['price_stars'], 'days' => $p['period_days'],
                'products' => $p['limits']['products'] ?? '—', 'ai' => $p['limits']['ai_requests_per_day'] ?? 0]);
            $kb[] = [$this->btn($this->t('bot.btn.buy_plan', ['plan' => $p['code']]), 'plan:buy:' . $p['code'])];
        }
        $kb[] = $this->back()[0];
        $text = $this->t('bot.plans_intro') . "\n\n" . implode("\n", $lines);
        $editMsg ? $this->edit($editMsg, $text, $kb) : $this->send($chat, $text, $kb);
    }

    private function onCallback(array $cb): void
    {
        $data = (string) ($cb['data'] ?? '');
        $msg = $cb['message'] ?? null;
        $chat = (int) ($msg['chat']['id'] ?? $cb['from']['id']);
        $answer = ['callback_query_id' => $cb['id']];
        if (preg_match('/^lang:(en|fa)$/', $data, $mm)) {
            $this->app->db->exec('UPDATE users SET locale = ?, locale_chosen = 1 WHERE id = ?', [$mm[1], $this->user['id']]);
            $this->locale = $mm[1];
            $this->user['locale_chosen'] = 1;
            $this->app->track('language_selected', $this->user['id'], null, ['locale' => $mm[1]]);
            $this->call('answerCallbackQuery', $answer + ['text' => $this->t('bot.language_set')]);
            $this->sendMain($chat, $msg);
            return;
        }
        $this->call('answerCallbackQuery', $answer);
        if (!$msg) return;
        switch (true) {
            case $data === 'menu:main':
                $this->sendMain($chat, $msg);
                return;
            case $data === 'trial:start':
                $res = $this->app->startTrial($this->user);
                if (!$res['started']) {
                    $this->send($chat, $this->t('bot.trial_already_used'), $this->mainMenu((bool) $this->app->listUserWorkspaces($this->user['id'])));
                    return;
                }
                $this->app->track('trial_activated', $this->user['id'], $res['workspace']['id'], ['via' => 'bot']);
                $this->send($chat, $this->t('bot.trial_started', ['minutes' => I18n::minutes($this->locale, $this->app->cfg->trialMinutes * 60)]),
                    [[$this->appBtn($this->t('bot.btn.open_app'))], $this->back()[0]]);
                return;
            case $data === 'menu:business':
                $ws = $this->app->listUserWorkspaces($this->user['id'])[0] ?? null;
                if (!$ws) {
                    $this->send($chat, $this->t('bot.no_workspace'), $this->mainMenu(false));
                    return;
                }
                $acc = $this->app->access($ws['id']);
                $status = match ($acc['state']) {
                    'trial' => $this->t('bot.status.trial', ['left' => I18n::minutes($this->locale, $acc['secondsLeft'])]),
                    'subscribed' => $this->t('bot.status.subscribed', ['plan' => $acc['plan']]),
                    default => $this->t('bot.status.expired'),
                };
                $ob = $this->app->onboarding($ws['id']);
                $kb = [[$this->appBtn($this->t('bot.btn.products'), '?p=products'), $this->appBtn($this->t('bot.btn.orders'), '?p=orders')]];
                if ($acc['state'] === 'expired') $kb[] = [$this->btn($this->t('bot.btn.plans'), 'menu:plans')];
                $kb[] = $this->back()[0];
                $this->edit($msg, $this->t('bot.business_summary', ['name' => htmlspecialchars($ws['name']), 'status' => $status,
                    'products' => $this->app->countProducts($ws['id']), 'orders' => $this->app->countOrders($ws['id']),
                    'done' => $ob['completed'], 'total' => $ob['total']]), $kb);
                return;
            case $data === 'menu:plans':
                $this->sendPlans($msg, $chat);
                return;
            case (bool) preg_match('/^plan:buy:([a-z0-9_]{2,32})$/', $data, $mm):
                $owned = null;
                foreach ($this->app->listUserWorkspaces($this->user['id']) as $w) if (in_array($w['role'], ['owner', 'admin'], true)) { $owned = $w; break; }
                if (!$owned) {
                    $this->send($chat, $this->t('bot.no_workspace'), $this->mainMenu(false));
                    return;
                }
                try {
                    $co = $this->app->createCheckout($owned['id'], $this->user, $mm[1]);
                    $this->send($chat, '⭐', [[['text' => $this->t('bot.btn.buy_plan', ['plan' => $mm[1]]), 'url' => $co['link']]]]);
                } catch (AppError) {
                    $this->send($chat, $this->t('bot.payments_unavailable'));
                }
                return;
            case $data === 'menu:support':
                $this->edit($msg, $this->t('bot.support_intro'), [[$this->appBtn($this->t('bot.btn.open_app'), '?p=support')], $this->back()[0]]);
                return;
            case $data === 'menu:ai':
                $this->edit($msg, $this->t('bot.ai_intro'), [[$this->appBtn($this->t('bot.btn.open_app'), '?p=ai')], $this->back()[0]]);
                return;
            case $data === 'menu:settings':
                $this->edit($msg, $this->t('bot.settings_intro'), [[$this->btn($this->t('bot.btn.language'), 'menu:language')], $this->back()[0]]);
                return;
            case $data === 'menu:language':
                $this->edit($msg, $this->t('bot.choose_language'), $this->langKb());
                return;
            case $data === 'menu:invite':
                $code = $this->app->db->one('SELECT code FROM referral_codes WHERE user_id = ?', [$this->user['id']])['code'] ?? null;
                if (!$code) {
                    $code = randomCode(8, 'abcdefghijkmnpqrstuvwxyz23456789');
                    $this->app->db->exec('INSERT INTO referral_codes (code, user_id) VALUES (?, ?)', [$code, $this->user['id']]);
                    $this->app->track('referral_created', $this->user['id']);
                }
                $this->edit($msg, $this->t('bot.invite_text', ['link' => "https://t.me/{$this->app->cfg->botUsername}?start=ref_{$code}"]), $this->back());
                return;
        }
    }
}
