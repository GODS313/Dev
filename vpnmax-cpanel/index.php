<?php
declare(strict_types=1);
session_start();
const DATA_FILE = __DIR__ . '/storage/data.json';
function load_data(): array {
    $raw = @file_get_contents(DATA_FILE); $data = $raw ? json_decode($raw, true) : null;
    return is_array($data) ? $data : ['admin_hash'=>'','settings'=>[]];
}
function save_data(array $data): bool {
    $fp = @fopen(DATA_FILE, 'c+'); if (!$fp) return false;
    $ok = false;
    if (flock($fp, LOCK_EX)) { rewind($fp); ftruncate($fp, 0); $ok = fwrite($fp, json_encode($data, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)) !== false; fflush($fp); flock($fp, LOCK_UN); }
    fclose($fp); return $ok;
}
function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function site_settings(array $data): array {
    return array_merge(['brand'=>'VPN Max','headline'=>'اینترنت آزاد، ساده و سریع','subheadline'=>'اپلیکیشن را دریافت کن و با کانفیگ آزمایشی شروع کن.','apk_url'=>'','apk_name'=>'','subscription_url'=>'','telegram_token'=>'','telegram_chat_id'=>'','telegram_enabled'=>false,'configs'=>[],'claims'=>[],'logs'=>[]], $data['settings'] ?? []);
}
function get_subscription_text(string $url): string {
    if (!preg_match('~^https://~i', $url)) throw new RuntimeException('لینک اشتراک باید با HTTPS شروع شود.');
    $parts = parse_url($url);
    if (!$parts || empty($parts['host']) || in_array(strtolower($parts['host']), ['localhost','127.0.0.1','::1'], true)) throw new RuntimeException('لینک اشتراک معتبر نیست.');
    if (filter_var($parts['host'], FILTER_VALIDATE_IP) && !filter_var($parts['host'], FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)) throw new RuntimeException('آدرس سرور اشتراک قابل قبول نیست.');
    if (function_exists('curl_init')) {
        $ch=curl_init($url);
        curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>12,CURLOPT_MAXFILESIZE=>3145728,CURLOPT_USERAGENT=>'VPNMaxConfigFetcher/1.0']);
        $body=curl_exec($ch); $status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE); $error=curl_error($ch); curl_close($ch);
        if ($body===false || $status<200 || $status>=300) throw new RuntimeException('خواندن فهرست کانفیگ‌ها انجام نشد. اتصال هاست یا اعتبار لینک اشتراک را بررسی کن.');
        if (strlen($body)>3145728) throw new RuntimeException('پاسخ اشتراک بزرگ‌تر از حد مجاز است.');
        return (string)$body;
    }
    $ctx=stream_context_create(['http'=>['timeout'=>12,'follow_location'=>0,'max_redirects'=>0],'ssl'=>['verify_peer'=>true,'verify_peer_name'=>true]]);
    $body=@file_get_contents($url,false,$ctx);
    if ($body===false || strlen($body)>3145728) throw new RuntimeException('خواندن فهرست کانفیگ‌ها انجام نشد.');
    return $body;
}
function parse_subscription_configs(string $body): array {
    $pattern = "~(?:vless|vmess|trojan|ss|ssr|hysteria2?|tuic|wireguard)://[^\\s<>\"']+~i";
    preg_match_all($pattern,$body,$m); $items=$m[0]??[];
    if (!$items) {
        $compact=preg_replace('/\\s+/', '', $body);
        $decoded=base64_decode($compact,true);
        if ($decoded!==false) { preg_match_all($pattern,$decoded,$m); $items=$m[0]??[]; }
    }
    $unique=[];
    foreach($items as $item){$item=trim($item," \t\n\r\0\x0B,;\"'"); if($item!=='')$unique[$item]=true;}
    return array_keys($unique);
}
function issue_config(string $phone): array {
    $lock=@fopen(__DIR__.'/storage/claim.lock','c+');
    if(!$lock || !flock($lock,LOCK_EX)) { if($lock)fclose($lock); return ['error'=>'ثبت درخواست هم‌زمان انجام نشد؛ دوباره تلاش کن.']; }
    try {
        $data=load_data(); $s=site_settings($data);
        foreach(($s['claims']??[]) as $claim) if(($claim['phone']??'')===$phone) return ['error'=>'این شماره قبلاً کانفیگ هدیهٔ خود را دریافت کرده است.'];
        if(empty($s['subscription_url'])) return ['error'=>'لینک اشتراک هنوز در پنل مدیریت تنظیم نشده است.'];
        $pool=parse_subscription_configs(get_subscription_text((string)$s['subscription_url']));
        if(!$pool) return ['error'=>'در لینک اشتراک کانفیگ قابل‌خواندن پیدا نشد. لینک باید فهرستی از کانفیگ‌های V2Ray سازگار برگرداند.'];
        $issued=[];
        foreach(($s['claims']??[]) as $claim) if(!empty($claim['config_hash']))$issued[$claim['config_hash']]=true;
        $available=[];
        foreach($pool as $config) if(!isset($issued[hash('sha256',$config)]))$available[]=$config;
        if(!$available)return ['error'=>'همهٔ کانفیگ‌های یکتای اشتراک قبلاً تخصیص داده شده‌اند.'];
        $config=$available[random_int(0,count($available)-1)]; $hash=hash('sha256',$config);
        $s['claims'][]=['phone'=>$phone,'config'=>$config,'config_hash'=>$hash,'created_at'=>date('c')];
        $s['logs'][]=['type'=>'تحویل کانفیگ','phone'=>$phone,'created_at'=>date('c')];
        if(count($s['logs'])>500)$s['logs']=array_slice($s['logs'],-500);
        if(!save_data(['admin_hash'=>$data['admin_hash']??'','settings'=>$s]))return ['error'=>'ذخیرهٔ اطلاعات انجام نشد؛ لطفاً دوباره تلاش کن.'];
        return ['config'=>$config,'settings'=>$s];
    } catch(Throwable $e) {
        return ['error'=>$e instanceof RuntimeException?$e->getMessage():'دریافت کانفیگ انجام نشد.'];
    } finally { flock($lock,LOCK_UN); fclose($lock); }
}
function send_telegram(array $s, string $text): void {
    if (empty($s['telegram_enabled']) || empty($s['telegram_token']) || empty($s['telegram_chat_id'])) return;
    $url = 'https://api.telegram.org/bot'.rawurlencode($s['telegram_token']).'/sendMessage';
    $body = http_build_query(['chat_id'=>$s['telegram_chat_id'],'text'=>$text,'parse_mode'=>'HTML']);
    if (function_exists('curl_init')) { $ch = curl_init($url); curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$body,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>5]); @curl_exec($ch); curl_close($ch); }
    else { $ctx = stream_context_create(['http'=>['method'=>'POST','header'=>"Content-Type: application/x-www-form-urlencoded\r\n",'content'=>$body,'timeout'=>5]]); @file_get_contents($url,false,$ctx); }
}
$data = load_data();
$s = site_settings($data);
$error = ''; $gift = null; $phone = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'claim') {
    $phone = preg_replace('/\s+/', '', trim((string)($_POST['phone'] ?? '')));
    $phone = strtr($phone,['۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9','٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9']);
    $csrf = (string)($_POST['csrf'] ?? '');
    if (!hash_equals($_SESSION['csrf'] ?? '', $csrf)) $error = 'درخواست معتبر نیست. صفحه را تازه‌سازی و دوباره تلاش کن.';
    elseif (!preg_match('/^(?:\+?98|0098|0)?9\d{9}$/', $phone)) $error = 'شمارهٔ موبایل را به شکل درست وارد کن؛ نمونه: ۰۹۱۲۳۴۵۶۷۸۹';
    else {
        $normalized = preg_replace('/^(?:\+?98|0098)/', '0', $phone);
        if (strlen($normalized) === 10 && $normalized[0] === '9') $normalized = '0'.$normalized;
        $result=issue_config($normalized);
        if(isset($result['error'])) $error=$result['error'];
        else {
            $gift=(string)$result['config']; $s=$result['settings'];
            $data['settings']=$s;
            if(!empty($_POST['log_consent'])) send_telegram($s, "🎁 <b>تحویل کانفیگ هدیه</b>\nشماره: <code>".h($normalized)."</code>");
        }
    }
}
if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(24));
$csrf = $_SESSION['csrf']; $apk = trim((string)$s['apk_url']);
if ($apk !== '' && !preg_match('~^https?://~i',$apk)) $apk = 'uploads/'.rawurlencode(basename($apk));
?>

<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#071c1a"><title><?=h($s['brand'])?> | اپلیکیشن VPN</title>
<link rel="stylesheet" href="app-ui.css">
</head>
<body class="app-body">
<main class="app-shell" id="home">
<header class="app-head">
  <a class="app-brand" href="#home"><span class="app-logo">V</span><span><b><?=h($s['brand'])?></b><small>اتصال خصوصی</small></span></a>
  <a class="support-chip" href="#gift" aria-label="پشتیبانی">؟</a>
</header>
<section class="connection-card">
  <div class="connection-label"><i></i> آماده برای شروع</div>
  <div class="connection-orbit"><div class="orbit-ring ring-a"></div><div class="orbit-ring ring-b"></div><div class="orbit-core"><span class="lock-icon"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="20" width="28" height="21" rx="6"/><path d="M16 20v-6a8 8 0 0 1 16 0v6"/><path d="M24 28v5"/></svg></span></div></div>
  <h1><?=h($s['headline'])?></h1>
  <p><?=h($s['subheadline'])?></p>
  <div class="connection-hint"><span class="tiny-shield">✓</span><span>برای شروع، اپلیکیشن را نصب کن</span></div>
</section>
<section class="quick-info" aria-label="وضعیت سرویس">
  <div class="info-tile"><span class="tile-icon">◎</span><small>حالت دسترسی</small><b>آزمایشی</b></div>
  <div class="tile-divider"></div>
  <div class="info-tile"><span class="tile-icon">✳</span><small>دریافت کانفیگ</small><b>یک‌بار برای هر شماره</b></div>
</section>
<section class="download-card" id="download">
  <div class="download-icon">↓</div><div class="download-copy"><b>اپلیکیشن VPN Max</b><small>نسخهٔ اندروید · نصب سریع</small></div>
  <?php if($apk):?><a class="download-action" href="<?=h($apk)?>" download aria-label="دانلود">دانلود</a><?php else:?><span class="download-action unavailable">به‌زودی</span><?php endif;?>
</section>
<section class="gift-card-app" id="gift">
  <div class="section-kicker"><span>هدیهٔ شروع</span><b>رایگان</b></div>
  <h2>دریافت کانفیگ آزمایشی</h2>
  <p>شمارهٔ موبایلت را وارد کن. یک آدرس تصادفی از اشتراک برایت نمایش داده می‌شود.</p>
  <form class="claim-form-app" method="post" action="#gift">
    <input type="hidden" name="action" value="claim"><input type="hidden" name="csrf" value="<?=h($csrf)?>">
    <label for="phone">شمارهٔ موبایل</label>
    <div class="phone-control"><span>+98</span><input id="phone" name="phone" inputmode="tel" autocomplete="tel" placeholder="912 345 6789" value="<?=h($phone)?>" required></div>
    <label class="consent-app"><input type="checkbox" name="log_consent" value="1"><span>با ارسال شماره برای ثبت هدیه در تلگرام موافقم.</span></label>
    <button class="claim-button" type="submit">گرفتن کانفیگ <span>←</span></button>
    <small class="privacy-app">شماره برای جلوگیری از دریافت دوباره نگهداری می‌شود.</small>
  </form>
</section>
<?php if($error):?><div class="notice-app"><?=h($error)?></div><?php endif;?>
<?php if($gift !== null):?><section class="config-result"><div class="result-title"><span>✓</span><div><b>کانفیگ آماده است</b><small>آدرس را کپی و در اپ وارد کن.</small></div></div><textarea id="gift-config" readonly><?=h($gift)?></textarea><button type="button" class="copy-config" data-copy="gift-config">کپی آدرس</button></section><?php endif;?>
<section class="howto"><div class="howto-heading"><span>سه مرحلهٔ ساده</span><b>از دانلود تا اتصال</b></div><div class="howto-row"><i>۱</i><span>اپ را نصب کن</span><b>›</b></div><div class="howto-row"><i>۲</i><span>شماره را بزن و کانفیگ بگیر</span><b>›</b></div><div class="howto-row"><i>۳</i><span>آدرس را در اپ وارد کن</span><b>✓</b></div></section>
<nav class="app-nav" aria-label="ناوبری اصلی"><a class="nav-item active" href="#home"><span>⌂</span><small>خانه</small></a><a class="nav-item" href="#download"><span>↓</span><small>دانلود</small></a><a class="nav-item" href="#gift"><span>✳</span><small>هدیه</small></a></nav>
<footer class="app-footer">© <?=date('Y')?> <?=h($s['brand'])?> <span>اتصال ساده و خصوصی</span></footer>
</main><script>
(() => {
  const form = document.querySelector('.claim-form-app');
  if (form) form.addEventListener('submit', () => {
    const button = form.querySelector('.claim-button');
    if (!button) return;
    button.disabled = true;
    button.textContent = 'در حال دریافت کانفیگ…';
    button.setAttribute('aria-live', 'polite');
  });
  document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(link => link.classList.remove('active'));
    item.classList.add('active');
  }));
  const copy = document.querySelector('.copy-config');
  if (copy) copy.addEventListener('click', async () => {
    const field = document.getElementById(copy.dataset.copy);
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(field.value);
      else { field.focus(); field.select(); document.execCommand('copy'); }
      copy.textContent = 'کپی شد ✓';
    } catch (e) { copy.textContent = 'متن را انتخاب و کپی کن'; }
  });
})();
</script></body></html>
