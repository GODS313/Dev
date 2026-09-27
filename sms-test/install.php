<?php
declare(strict_types=1);
$lock=__DIR__.'/storage/installed.lock';
if (is_file($lock)) { http_response_code(404); exit('Installer قفل شده است.'); }
$checks=['PHP 8.1+'=>version_compare(PHP_VERSION,'8.1.0','>='),'PDO MySQL'=>extension_loaded('pdo_mysql'),'OpenSSL'=>extension_loaded('openssl'),'JSON'=>extension_loaded('json'),'Random'=>function_exists('random_bytes'),'HTTPS'=>(!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off')||($_SERVER['HTTP_X_FORWARDED_PROTO']??'')==='https','app writable'=>is_writable(__DIR__.'/app'),'storage writable'=>is_writable(__DIR__.'/storage')];
$error=''; $done=false;
if ($_SERVER['REQUEST_METHOD']==='POST') {
  $dbhost=trim($_POST['db_host']??''); $dbname=trim($_POST['db_name']??''); $dbuser=trim($_POST['db_user']??''); $dbpass=(string)($_POST['db_pass']??''); $username=trim($_POST['username']??''); $password=(string)($_POST['password']??'');
  if (in_array(false,$checks,true)) $error='برخی پیش‌نیازهای بالا برقرار نیست. نصب روی HTTPS و PHP 8.1 یا بالاتر انجام شود.';
  elseif (!preg_match('/^[A-Za-z0-9_]{1,64}$/',$dbname)||!preg_match('/^[A-Za-z0-9_]{1,64}$/',$dbuser)||$dbhost==='') $error='اطلاعات دیتابیس معتبر نیست.';
  elseif (!preg_match('/^[A-Za-z0-9_.-]{3,80}$/',$username)||strlen($password)<12) $error='نام کاربری معتبر و رمز حداقل ۱۲ کاراکتری وارد کنید.';
  else try {
    $pdo=new PDO('mysql:host='.$dbhost.';dbname='.$dbname.';charset=utf8mb4',$dbuser,$dbpass,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    $sql=file_get_contents(__DIR__.'/app/schema.sql'); foreach (array_filter(array_map('trim',explode(';',$sql))) as $statement) $pdo->exec($statement);
    $q=$pdo->prepare('INSERT INTO admins(username,password_hash,created_at) VALUES(?,?,NOW())'); $q->execute([$username,password_hash($password,PASSWORD_DEFAULT)]);
    $apiSecret=bin2hex(random_bytes(32)); $appKey=bin2hex(random_bytes(32));
    $config="<?php\nreturn ".var_export(['dsn'=>'mysql:host='.$dbhost.';dbname='.$dbname.';charset=utf8mb4','db_user'=>$dbuser,'db_pass'=>$dbpass,'app_key'=>$appKey,'installed_at'=>date(DATE_ATOM)],true).";\n";
    if (file_put_contents(__DIR__.'/app/config.php',$config,LOCK_EX)===false) throw new RuntimeException('امکان ذخیره تنظیمات نیست. مجوز پوشه app را بررسی کنید.'); chmod(__DIR__.'/app/config.php',0600);
    $pdo->prepare('INSERT INTO settings(setting_key,setting_value,updated_at) VALUES(?,?,NOW()),(?,?,NOW()),(?,?,NOW())')->execute(['api_secret_hash',hash('sha256',$apiSecret),'test_mode','1','send_interval_seconds','30']);
    file_put_contents($lock,date(DATE_ATOM),LOCK_EX); chmod($lock,0600);
    $done=true; $shownSecret=$apiSecret;
  } catch(Throwable $e) { $error='نصب انجام نشد: '.htmlspecialchars($e->getMessage(),ENT_QUOTES,'UTF-8'); }
}
?><!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>نصب Etebarami SMS Gateway</title><style>body{font:16px Tahoma;background:#f3f6fb;color:#182238;margin:0;padding:3vh 5vw}.box{max-width:680px;margin:auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 12px 50px #18223818}input{display:block;width:100%;box-sizing:border-box;padding:12px;margin:7px 0 14px;border:1px solid #ccd5e2;border-radius:8px}button{background:#1769e0;color:#fff;padding:12px 20px;border:0;border-radius:8px}.ok{color:#08754d}.err{color:#ad2635}</style><main class="box"><h1>نصب Etebarami SMS Gateway</h1><?php if($done): ?><h2 class="ok">نصب تکمیل شد</h2><p>Installer قفل شد. وارد پنل شوید و API Secret زیر را فقط برای اتصال‌های موردنیاز نگه دارید.</p><code><?=htmlspecialchars($shownSecret,ENT_QUOTES,'UTF-8')?></code><p><a href="index.php">ورود به پنل</a></p><?php else: ?><h3>بررسی سازگاری</h3><ul><?php foreach($checks as $name=>$ok): ?><li class="<?=$ok?'ok':'err'?>"><?=htmlspecialchars($name)?>: <?=$ok?'آماده':'نیازمند اصلاح'?></li><?php endforeach ?></ul><?php if($error): ?><p class="err"><?=$error?></p><?php endif ?><form method="post"><label>میزبان دیتابیس<input name="db_host" value="localhost" required></label><label>نام دیتابیس<input name="db_name" required></label><label>کاربر دیتابیس<input name="db_user" required></label><label>رمز دیتابیس<input name="db_pass" type="password"></label><label>نام کاربری مدیر<input name="username" required></label><label>رمز مدیر (حداقل ۱۲ کاراکتر)<input name="password" type="password" minlength="12" required></label><button>نصب و ایجاد جداول</button></form><?php endif ?></main></html>
