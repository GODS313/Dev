<?php

declare(strict_types=1);

$library = '/usr/local/lib/seskia-admin/panel-lib.php';
if (!is_file($library) || is_link($library)) {
    http_response_code(503);
    exit('Admin panel library is not installed.');
}
require_once $library;

panel_boot();

function h(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function redirect_panel(): never
{
    header('Location: /admin.php', true, 303);
    exit;
}

$action = (string) ($_POST['action'] ?? '');
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        panel_require_csrf();
        if ($action === 'login') {
            if (!panel_login((string) ($_POST['password'] ?? ''))) {
                throw new RuntimeException('رمز ورود صحیح نیست.');
            }
            panel_audit('admin_login');
            panel_flash('success', 'ورود موفق بود.');
            redirect_panel();
        }
        if (!panel_is_authenticated()) {
            throw new RuntimeException('نشست مدیریت منقضی شده است.');
        }
        panel_touch_auth();
        if ($action === 'logout') {
            panel_audit('admin_logout');
            panel_logout();
            header('Location: /admin.php', true, 303);
            exit;
        }
        if ($action === 'telegram_config') {
            $username = panel_update_telegram($_POST);
            panel_flash('success', "تنظیمات ذخیره و webhook بات @{$username} فعال شد. بات بله تغییری نکرد.");
            redirect_panel();
        }
        if ($action === 'upload_apk') {
            $result = panel_publish_upload($_FILES['apk_file'] ?? []);
            if (!empty($result['duplicate'])) {
                panel_flash('info', 'این APK همین حالا نسخه فعال است و دوباره منتشر نشد.');
            } else {
                panel_flash(
                    'success',
                    'APK منتشر و لینک عمومی تأیید شد. SHA-256: ' . substr((string) $result['sha256'], 0, 16) . '…'
                );
            }
            redirect_panel();
        }
        if ($action === 'rollback') {
            if ((string) ($_POST['rollback_confirm'] ?? '') !== 'yes') {
                throw new RuntimeException('تأیید بازگردانی انتخاب نشده است.');
            }
            $result = panel_rollback_latest();
            panel_flash(
                'success',
                'نسخه قبلی با موفقیت بازگردانده شد. SHA-256: ' . substr((string) $result['sha256'], 0, 16) . '…'
            );
            redirect_panel();
        }
        if ($action === 'change_password') {
            panel_change_password(
                (string) ($_POST['current_password'] ?? ''),
                (string) ($_POST['new_password'] ?? ''),
                (string) ($_POST['confirm_password'] ?? '')
            );
            panel_flash('success', 'رمز پنل مدیریت تغییر کرد.');
            redirect_panel();
        }
        throw new RuntimeException('عملیات ناشناخته است.');
    } catch (Throwable $error) {
        panel_audit('admin_action_failed', ['action' => $action, 'error' => get_class($error)]);
        panel_flash('error', $error->getMessage());
        redirect_panel();
    }
}

$authenticated = panel_is_authenticated();
if ($authenticated) {
    panel_touch_auth();
}
$flash = panel_take_flash();
$nonce = panel_nonce();
$csrf = panel_csrf();
$status = null;
$statusError = '';
if ($authenticated) {
    try {
        $status = panel_status();
    } catch (Throwable $error) {
        $statusError = $error->getMessage();
    }
}
?><!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>پنل مدیریت همکاره</title>
  <style nonce="<?= h($nonce) ?>">
    :root{--navy:#0d3158;--blue:#156b8a;--mint:#20b49c;--gold:#e3ad32;--ink:#172b3a;--muted:#627685;--line:#dce6eb;--bg:#eff4f6;--white:#fff;--danger:#b42318;--success:#08745e;--shadow:0 18px 55px rgba(13,49,88,.12)}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#eef4f6,#f8fafb);color:var(--ink);font-family:Tahoma,Arial,sans-serif;line-height:1.75}.shell{width:min(1120px,calc(100% - 28px));margin:auto}.top{background:var(--navy);color:#fff}.top .shell{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:16px}.brand{display:flex;align-items:center;gap:12px}.mark{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(145deg,var(--blue),var(--mint));font-weight:900}.brand strong{display:block;font-size:1.08rem}.brand small{display:block;opacity:.72}.logout{margin:0}.logout button{background:transparent;border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px 13px;border-radius:11px;cursor:pointer;font:inherit}.main{padding:28px 0 60px}.notice{padding:13px 15px;border-radius:13px;margin-bottom:18px;border:1px solid}.notice.success{background:#e9f8f3;color:var(--success);border-color:#bfe8da}.notice.error{background:#fff0ee;color:var(--danger);border-color:#f2c8c2}.notice.info{background:#eef6fb;color:#145c79;border-color:#cce2ed}.hero{background:linear-gradient(125deg,var(--navy),var(--blue));color:#fff;border-radius:22px;padding:24px;margin-bottom:18px;box-shadow:var(--shadow)}.hero h1{margin:0 0 4px;font-size:1.55rem}.hero p{margin:0;opacity:.8}.badges{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.badge{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);padding:6px 10px;border-radius:99px;font-size:.82rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.card{background:var(--white);border:1px solid var(--line);border-radius:18px;padding:21px;box-shadow:0 8px 30px rgba(13,49,88,.05)}.card.full{grid-column:1/-1}.card h2{margin:0 0 3px;color:var(--navy);font-size:1.18rem}.lead{margin:0 0 16px;color:var(--muted);font-size:.9rem}.fields{display:grid;grid-template-columns:1fr 1fr;gap:13px}.field{display:flex;flex-direction:column;gap:6px}.field.full{grid-column:1/-1}label{font-weight:700;font-size:.87rem}input{width:100%;min-height:46px;border:1px solid var(--line);border-radius:11px;background:#fbfdfd;padding:0 12px;font:inherit;color:var(--ink);outline:none}input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(21,107,138,.1)}input[type=file]{padding:9px}.hint{font-size:.77rem;color:var(--muted);font-weight:400}.button{border:0;border-radius:12px;min-height:46px;padding:0 17px;font:inherit;font-weight:800;cursor:pointer;background:var(--navy);color:#fff}.button.gold{background:var(--gold);color:#172b3a}.button.danger{background:#fff0ee;color:var(--danger);border:1px solid #f2c8c2}.actions{display:flex;gap:10px;align-items:center;margin-top:15px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}.stat{background:#f5f8fa;border:1px solid var(--line);border-radius:13px;padding:12px}.stat b{display:block;color:var(--navy);font-size:.96rem;overflow-wrap:anywhere}.stat span{display:block;color:var(--muted);font-size:.76rem}.safety{display:flex;gap:9px;align-items:flex-start;background:#fff9e9;border:1px solid #eedca9;border-radius:13px;padding:12px;margin-top:14px;font-size:.84rem}.check{display:flex;align-items:flex-start;gap:8px;margin-top:12px;font-size:.85rem}.check input{width:auto;min-height:auto;margin-top:6px}.login-wrap{min-height:100vh;display:grid;place-items:center;padding:20px}.login{width:min(440px,100%);background:#fff;border:1px solid var(--line);border-radius:24px;padding:28px;box-shadow:var(--shadow)}.login .mark{margin-bottom:16px;color:#fff}.login h1{margin:0}.login p{color:var(--muted);margin:6px 0 18px}.login .button{width:100%;margin-top:14px}.mono{direction:ltr;text-align:left;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.footer{text-align:center;color:var(--muted);font-size:.78rem;padding-top:22px}@media(max-width:760px){.grid,.fields{grid-template-columns:1fr}.card.full,.field.full{grid-column:auto}.stats{grid-template-columns:1fr 1fr}.top .shell{min-height:68px}.brand small{display:none}.main{padding-top:18px}}
  </style>
</head>
<body>
<?php if (!$authenticated): ?>
  <main class="login-wrap">
    <section class="login">
      <div class="mark">هم</div>
      <h1>پنل مدیریت همکاره</h1>
      <p>مدیریت امن بات گزارش و فایل APK بدون تغییر در بات بله</p>
      <?php if ($flash): ?><div class="notice <?= h($flash['type']) ?>"><?= h($flash['message']) ?></div><?php endif; ?>
      <form method="post" autocomplete="off">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="action" value="login">
        <label for="password">رمز مدیریت</label>
        <input id="password" name="password" type="password" minlength="12" maxlength="200" autocomplete="current-password" required autofocus>
        <button class="button" type="submit">ورود امن</button>
      </form>
    </section>
  </main>
<?php else: ?>
  <header class="top">
    <div class="shell">
      <div class="brand"><div class="mark">هم</div><div><strong>مدیریت همکاره</strong><small>Telegram APK & Report Control</small></div></div>
      <form class="logout" method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="logout"><button type="submit">خروج</button></form>
    </div>
  </header>
  <main class="shell main">
    <?php if ($flash): ?><div class="notice <?= h($flash['type']) ?>"><?= h($flash['message']) ?></div><?php endif; ?>
    <?php if ($statusError): ?><div class="notice error"><?= h($statusError) ?></div><?php endif; ?>
    <section class="hero">
      <h1>کنترل مرکزی APK و گزارش تلگرام</h1>
      <p>توکن بات مخصوص آپلود، چت گزارش و فایل اپلیکیشن را از همین صفحه تغییر بده.</p>
      <div class="badges"><span class="badge">بله: بدون تغییر</span><span class="badge">APK: بکاپ و rollback</span><span class="badge">توکن: خارج از مخزن</span><span class="badge">لینک ثابت: Adlisho</span></div>
      <?php if ($status): ?>
      <div class="stats">
        <div class="stat"><b><?= h($status['token_masked']) ?></b><span>توکن بات آپلود</span></div>
        <div class="stat"><b><?= h(count($status['chat_ids'])) ?></b><span>چت گزارش</span></div>
        <div class="stat"><b><?= h($status['backup_count']) ?></b><span>نسخه پشتیبان</span></div>
        <div class="stat"><b><?= h($status['live_size'] ? number_format($status['live_size'] / 1048576, 2) . ' MB' : 'ندارد') ?></b><span>APK فعال</span></div>
      </div>
      <?php endif; ?>
    </section>

    <?php if ($status): ?><div class="grid">
      <section class="card full">
        <h2>تنظیمات بات آپلود و گزارش</h2>
        <p class="lead">با ذخیره توکن جدید، اعتبار آن بررسی و webhook امن همان بات فعال می‌شود. توکن خالی یعنی توکن فعلی حفظ شود.</p>
        <form method="post" autocomplete="off">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="telegram_config">
          <div class="fields">
            <div class="field full"><label for="bot_token">توکن بات تلگرام مخصوص آپلود APK <span class="hint">توکن بات بله یا بات استخدامی را اینجا وارد نکن</span></label><input class="mono" id="bot_token" name="bot_token" type="password" maxlength="120" autocomplete="new-password" placeholder="خالی بگذار تا توکن فعلی حفظ شود"></div>
            <div class="field"><label for="admin_chat_ids">آیدی عددی مدیران مجاز آپلود</label><input class="mono" id="admin_chat_ids" name="admin_chat_ids" value="<?= h(implode(',', $status['admin_chat_ids'])) ?>" placeholder="123456789,987654321" required></div>
            <div class="field"><label for="chat_ids">چت‌آیدی گزارش <span class="hint">گروه یا گفت‌وگوی دریافت گزارش</span></label><input class="mono" id="chat_ids" name="chat_ids" value="<?= h(implode(',', $status['chat_ids'])) ?>" placeholder="-1001234567890" required></div>
            <div class="field full"><label for="apk_channel_ids">کانال‌های مجاز ارسال APK <span class="hint">اختیاری؛ هر شناسه کانال با ‎-100 شروع شود</span></label><input class="mono" id="apk_channel_ids" name="apk_channel_ids" value="<?= h(implode(',', $status['apk_channel_ids'])) ?>" placeholder="-1001234567890"></div>
          </div>
          <div class="safety"><b>نکته:</b><span>بات بله، فایل‌های `bale.php` و تنظیمات Bale در این عملیات خوانده یا نوشته نمی‌شوند.</span></div>
          <div class="actions"><button class="button" type="submit">ذخیره و اتصال بات</button></div>
        </form>
      </section>

      <section class="card">
        <h2>آپلود نسخه جدید APK</h2>
        <p class="lead">ساختار ZIP، امضای release و تطبیق آن با گواهی رسمی، اندازه و SHA-256 قبل از انتشار بررسی می‌شوند.</p>
        <form method="post" enctype="multipart/form-data">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="upload_apk"><input type="hidden" name="MAX_FILE_SIZE" value="209715200">
          <div class="field"><label for="apk_file">فایل APK امضاشده، حداکثر ۲۰۰ MB</label><input id="apk_file" name="apk_file" type="file" accept=".apk,application/vnd.android.package-archive" required></div>
          <div class="actions"><button class="button gold" type="submit">اعتبارسنجی و انتشار</button></div>
        </form>
        <div class="safety"><b>لینک ثابت:</b><span class="mono"><?= h($status['public_url']) ?></span></div>
        <p class="hint mono">Release signer: <?= h($status['apk_signer_masked']) ?></p>
        <?php if ($status['live_sha256']): ?><p class="hint mono">SHA-256 فعلی: <?= h($status['live_sha256']) ?></p><?php endif; ?>
      </section>

      <section class="card">
        <h2>بازگردانی نسخه قبل</h2>
        <p class="lead">جدیدترین بکاپ معتبر با قفل تک‌نویسنده جایگزین می‌شود و لینک عمومی دوباره بررسی خواهد شد.</p>
        <form method="post">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="rollback">
          <label class="check"><input type="checkbox" name="rollback_confirm" value="yes" required><span>تأیید می‌کنم نسخه فعال فعلی با جدیدترین بکاپ جایگزین شود.</span></label>
          <div class="actions"><button class="button danger" type="submit">بازگردانی نسخه قبل</button></div>
        </form>
      </section>

      <section class="card full">
        <h2>تغییر رمز پنل</h2>
        <p class="lead">رمز حداقل ۱۲ نویسه باشد و در هیچ فایل عمومی یا GitHub ذخیره نمی‌شود.</p>
        <form method="post" autocomplete="off">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="action" value="change_password">
          <div class="fields">
            <div class="field"><label for="current_password">رمز فعلی</label><input id="current_password" name="current_password" type="password" autocomplete="current-password" required></div>
            <div class="field"><label for="new_password">رمز جدید</label><input id="new_password" name="new_password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required></div>
            <div class="field"><label for="confirm_password">تکرار رمز جدید</label><input id="confirm_password" name="confirm_password" type="password" minlength="12" maxlength="200" autocomplete="new-password" required></div>
          </div>
          <div class="actions"><button class="button" type="submit">تغییر رمز</button></div>
        </form>
      </section>
    </div><?php endif; ?>
    <footer class="footer">همکاره — پنل خصوصی مدیریت انتشار</footer>
  </main>
<?php endif; ?>
</body>
</html>
