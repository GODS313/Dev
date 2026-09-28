<?php
declare(strict_types=1);
session_start();
const DATA_FILE = __DIR__ . '/storage/data.json';
function load_data(): array { $raw=@file_get_contents(DATA_FILE); $d=$raw?json_decode($raw,true):null; return is_array($d)?$d:['admin_hash'=>'','settings'=>[]]; }
function save_data(array $d): bool {
    $fp=@fopen(DATA_FILE,'c+'); if(!$fp)return false; $ok=false;
    if(flock($fp,LOCK_EX)){rewind($fp);ftruncate($fp,0);$ok=fwrite($fp,json_encode($d,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES))!==false;fflush($fp);flock($fp,LOCK_UN);}
    fclose($fp);return $ok;
}
function h(string $s):string{return htmlspecialchars($s,ENT_QUOTES,'UTF-8');}
$data=load_data(); $s=array_merge(['brand'=>'VPN Max','headline'=>'اینترنت آزاد، ساده و سریع','subheadline'=>'اپلیکیشن را دریافت کن و با کانفیگ آزمایشی شروع کن.','apk_url'=>'','apk_name'=>'','subscription_url'=>'','telegram_token'=>'','telegram_chat_id'=>'','telegram_enabled'=>false,'configs'=>[],'claims'=>[],'logs'=>[]],$data['settings']??[]);
$msg='';$err='';
if(isset($_GET['logout'])){session_destroy();header('Location: admin.php');exit;}
if(empty($_SESSION['admin_csrf']))$_SESSION['admin_csrf']=bin2hex(random_bytes(24));$csrf=$_SESSION['admin_csrf'];
if($_SERVER['REQUEST_METHOD']==='POST'){
    if(!hash_equals($csrf,(string)($_POST['csrf']??'')))$err='درخواست معتبر نیست. صفحه را تازه‌سازی کن.';
    elseif(empty($data['admin_hash'])){
        $p=(string)($_POST['password']??'');$p2=(string)($_POST['password2']??'');
        if(strlen($p)<12)$err='رمز عبور باید دست‌کم ۱۲ نویسه داشته باشد.';
        elseif($p!==$p2)$err='تکرار رمز عبور یکسان نیست.';
        else{$data['admin_hash']=password_hash($p,PASSWORD_DEFAULT);if(save_data($data)){$_SESSION['admin_ok']=true;header('Location: admin.php');exit;}else$err='ذخیرهٔ تنظیم اولیه انجام نشد.';}
    }elseif(empty($_SESSION['admin_ok']) && isset($_POST['login'])){
        if(password_verify((string)($_POST['password']??''),(string)$data['admin_hash'])){session_regenerate_id(true);$_SESSION['admin_ok']=true;header('Location: admin.php');exit;}else$err='رمز عبور اشتباه است.';
    }elseif(!empty($_SESSION['admin_ok']) && isset($_POST['save'])){
        $s['brand']=trim((string)($_POST['brand']??'VPN Max'));
        $s['headline']=trim((string)($_POST['headline']??''));
        $s['subheadline']=trim((string)($_POST['subheadline']??''));
        $s['configs']=$s['configs']??[];
        $s['telegram_token']=trim((string)($_POST['telegram_token']??''));
        $s['telegram_chat_id']=trim((string)($_POST['telegram_chat_id']??''));
        $s['telegram_enabled']=isset($_POST['telegram_enabled']);
        $new_subscription=trim((string)($_POST['subscription_url']??''));
        if($new_subscription!=='' && !preg_match('~^https://~i',$new_subscription))$err='لینک اشتراک باید با HTTPS شروع شود.';
        elseif($new_subscription!=='')$s['subscription_url']=$new_subscription;
        if(isset($_POST['clear_subscription']))$s['subscription_url']='';
        $url=trim((string)($_POST['apk_url']??''));
        if(isset($_FILES['apk_file']) && $_FILES['apk_file']['error']!==UPLOAD_ERR_NO_FILE){
            $f=$_FILES['apk_file'];
            $ext=strtolower(pathinfo($f['name']??'',PATHINFO_EXTENSION));
            if($f['error']!==UPLOAD_ERR_OK)$err='بارگذاری فایل با خطا روبه‌رو شد. محدودیت upload_max_filesize هاست را بررسی کن.';
            elseif(!in_array($ext,['apk','pdf','docx','zip'],true))$err='فقط فایل APK، PDF، DOCX یا ZIP پذیرفته می‌شود.';
            elseif(($f['size']??0)>150*1024*1024)$err='حداکثر حجم فایل ۱۵۰ مگابایت است.';
            else{$name='release-'.bin2hex(random_bytes(6)).'.'.$ext;$dest=__DIR__.'/uploads/'.$name;if(move_uploaded_file($f['tmp_name'],$dest)){$url=$name;$s['apk_name']=basename($f['name']);}else$err='ذخیرهٔ فایل انجام نشد.';}
        }
        if(!$err && $url!=='' && !preg_match('~^(https?://|[a-zA-Z0-9._/-]+)$~',$url))$err='آدرس فایل معتبر نیست.';
        $s['apk_url']=$url;
        if(!$err){$data['settings']=$s;if(save_data($data)){$msg='تنظیمات ذخیره شد.';$data=load_data();$s=$data['settings'];}else$err='ذخیرهٔ تنظیمات انجام نشد. دسترسی نوشتن پوشهٔ storage را بررسی کن.';}
    }
}
$setup=empty($data['admin_hash']);$logged=!empty($_SESSION['admin_ok']);
$subscription_status=!empty($s['subscription_url'])?'فعال':'تنظیم نشده';
$claim_count=count($s['claims']??[]);
?>
<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>مدیریت | <?=h($s['brand'])?></title><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="admin.css"></head><body class="admin-body"><main class="admin-wrap"><header class="admin-head"><a href="./" class="brand"><span class="brand-mark">V</span><?=h($s['brand'])?></a><?php if($logged):?><a class="logout" href="?logout=1">خروج از پنل</a><?php endif;?></header>
<?php if($setup):?><section class="admin-card auth-card"><span class="eyebrow">راه‌اندازی اولیه</span><h1>ساخت رمز مدیر</h1><p>یک رمز قوی بساز. این صفحه بعد از تنظیم رمز به فرم ورود تبدیل می‌شود.</p><?php if($err):?><div class="notice notice-error"><?=h($err)?></div><?php endif;?><form method="post"><input type="hidden" name="csrf" value="<?=h($csrf)?>"><label>رمز عبور جدید<input type="password" name="password" minlength="12" required autocomplete="new-password"></label><label>تکرار رمز عبور<input type="password" name="password2" minlength="12" required autocomplete="new-password"></label><button class="button button-primary">راه‌اندازی پنل</button></form></section>
<?php elseif(!$logged):?><section class="admin-card auth-card"><span class="eyebrow">پنل مدیریت</span><h1>ورود مدیر</h1><p>برای ویرایش سایت، رمز مدیریت را وارد کن.</p><?php if($err):?><div class="notice notice-error"><?=h($err)?></div><?php endif;?><form method="post"><input type="hidden" name="csrf" value="<?=h($csrf)?>"><label>رمز عبور<input type="password" name="password" required autocomplete="current-password"></label><button class="button button-primary" name="login" value="1">ورود</button></form></section>
<?php else:?><section class="dashboard-title"><div><span class="eyebrow">داشبورد سایت</span><h1>تنظیمات <?=h($s['brand'])?></h1></div><a class="preview-link" href="./" target="_blank">مشاهدهٔ سایت ↗</a></section><?php if($msg):?><div class="notice notice-ok"><?=h($msg)?></div><?php endif;?><?php if($err):?><div class="notice notice-error"><?=h($err)?></div><?php endif;?>
<div class="stats"><div><span>لینک اشتراک</span><b><?=h($subscription_status)?></b></div><div><span>هدیه تحویل‌شده</span><b><?=number_format($claim_count)?></b></div><div><span>گزارش ثبت‌شده</span><b><?=number_format(count($s['logs']??[]))?></b></div></div>
<form method="post" enctype="multipart/form-data" class="admin-form"><input type="hidden" name="csrf" value="<?=h($csrf)?>">
<section class="admin-card"><div class="card-title"><span>01</span><div><h2>متن و دانلود</h2><p>عنوان صفحه و فایل اپلیکیشن را تنظیم کن.</p></div></div><div class="fields"><label>نام سرویس<input name="brand" value="<?=h($s['brand'])?>" required></label><label>تیتر اصلی<input name="headline" value="<?=h($s['headline'])?>" required></label><label class="wide">متن توضیحی<textarea name="subheadline" rows="2"><?=h($s['subheadline'])?></textarea></label><label class="wide">لینک مستقیم دانلود (اختیاری)<input name="apk_url" value="<?=h($s['apk_url'])?>" placeholder="https://... یا نام فایل بارگذاری‌شده"></label><label class="wide">یا بارگذاری فایل جدید <input type="file" name="apk_file" accept=".apk,.pdf,.docx,.zip"><small>APK / PDF / DOCX / ZIP — حداکثر ۱۵۰ مگابایت، با توجه به محدودیت‌های PHP هاست.</small></label></div></section>
<section class="admin-card"><div class="card-title"><span>02</span><div><h2>اشتراک کانفیگ‌ها</h2><p>سایت فهرست اشتراک را می‌خواند و یک آدرس تصادفی را به هر شماره می‌دهد.</p></div></div><label>لینک اشتراک جدید<input type="password" name="subscription_url" value="" autocomplete="new-password" placeholder="برای حفظ لینک فعلی، این قسمت را خالی بگذار"></label><label class="toggle clear-toggle"><input type="checkbox" name="clear_subscription" value="1"><span>پاک‌کردن لینک اشتراک فعلی</span></label><div class="inline-note">لینک اشتراک خصوصی می‌ماند و در فایل تنظیمات حفاظت‌شدهٔ هاست ذخیره می‌شود. سایت کانفیگ‌های VLESS، VMESS، Trojan، Shadowsocks و چند قالب رایج دیگر را از پاسخ متنی یا Base64 می‌خواند. هر آدرس فقط یک‌بار به یک شماره تخصیص می‌یابد.</div></section>
<section class="admin-card"><div class="card-title"><span>03</span><div><h2>گزارش تلگرام</h2><p>شماره فقط برای کاربری به تلگرام می‌رود که گزینهٔ رضایت را علامت زده باشد.</p></div></div><label class="toggle"><input type="checkbox" name="telegram_enabled" value="1" <?=!empty($s['telegram_enabled'])?'checked':''?>><span>ارسال گزارش‌های تلگرام فعال باشد</span></label><div class="fields"><label>Bot Token<input name="telegram_token" value="<?=h($s['telegram_token'])?>" autocomplete="off" placeholder="توکن ربات"></label><label>Chat ID<input name="telegram_chat_id" value="<?=h($s['telegram_chat_id'])?>" autocomplete="off" placeholder="شناسهٔ گروه یا گفت‌وگو"></label></div><div class="inline-note">توکن در فایل دادهٔ خصوصی روی هاست ذخیره می‌شود. برای استفاده از تلگرام، خروجی HTTPS و cURL یا allow_url_fopen باید روی هاست فعال باشد.</div></section>
<div class="savebar"><button class="button button-primary" name="save" value="1">ذخیرهٔ همهٔ تغییرات</button><span>فهرست لاگ‌ها فقط ۵۰۰ مورد آخر را نگه می‌دارد.</span></div></form>
<section class="admin-card log-card"><div class="card-title"><span>04</span><div><h2>آخرین تحویل‌ها</h2><p>شماره و زمان تحویل هدیه</p></div></div><?php if(empty($s['logs'])):?><p class="empty">هنوز هدیه‌ای تحویل نشده است.</p><?php else:?><div class="table-wrap"><table><thead><tr><th>شماره</th><th>رویداد</th><th>زمان</th></tr></thead><tbody><?php foreach(array_reverse(array_slice($s['logs'],-30)) as $log):?><tr><td><?=h((string)($log['phone']??''))?></td><td><?=h((string)($log['type']??''))?></td><td><?=h((string)($log['created_at']??''))?></td></tr><?php endforeach;?></tbody></table></div><?php endif;?></section>
<?php endif;?></main></body></html>
