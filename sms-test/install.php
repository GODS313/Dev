<?php
declare(strict_types=1);
$lock=__DIR__.'/storage/installed.lock';
if (is_file($lock)) { http_response_code(404); exit('Installer قفل شده است.'); }
$checks=['PHP 8.1+'=>version_compare(PHP_VERSION,'8.1.0','>='),'PDO SQLite'=>class_exists('PDO') && extension_loaded('pdo_sqlite') && in_array('sqlite',PDO::getAvailableDrivers(),true),'OpenSSL'=>extension_loaded('openssl'),'JSON'=>extension_loaded('json'),'Random'=>function_exists('random_bytes'),'HTTPS'=>(!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off')||($_SERVER['HTTP_X_FORWARDED_PROTO']??'')==='https','app writable'=>is_writable(__DIR__.'/app'),'storage writable'=>is_writable(__DIR__.'/storage')];
$error=''; $done=false;
if ($_SERVER['REQUEST_METHOD']==='POST') {
  $username=trim($_POST['username']??''); $password=(string)($_POST['password']??'');
  if (in_array(false,$checks,true)) $error='پیش‌نیازهای بالا را در cPanel فعال کنید. نصب باید با HTTPS و افزونه PDO SQLite انجام شود.';
  elseif (!preg_match('/^[A-Za-z0-9_.-]{3,80}$/',$username)||strlen($password)<12) $error='نام کاربری معتبر و رمز حداقل ۱۲ کاراکتری وارد کنید.';
  else {
    $dbPath=__DIR__.'/storage/gateway.sqlite'; $createdDb=false;
    try {
      if (is_file($dbPath)) throw new RuntimeException('فایل دیتابیس از قبل وجود دارد. برای نصب تازه، فایل دیتابیس قبلی را از storage پاک کنید.');
      $createdDb=true; $pdo=new PDO('sqlite:'.$dbPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
      $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 5000');
      $pdo->beginTransaction();
      $sql=file_get_contents(__DIR__.'/app/schema.sql'); foreach (array_filter(array_map('trim',explode(';',$sql))) as $statement) $pdo->exec($statement);
      $q=$pdo->prepare('INSERT INTO admins(username,password_hash,created_at) VALUES(?,?,CURRENT_TIMESTAMP)'); $q->execute([$username,password_hash($password,PASSWORD_DEFAULT)]);
      $apiSecret=bin2hex(random_bytes(32));
      $appKey=bin2hex(random_bytes(32));
      $q=$pdo->prepare('INSERT INTO settings(setting_key,setting_value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)');
      foreach (['api_secret_hash'=>hash('sha256',$apiSecret),'test_mode'=>'1','send_interval_seconds'=>'30'] as $k=>$v) $q->execute([$k,$v]);
      $pdo->commit(); unset($pdo); chmod($dbPath,0600);
      $config="<?php\nreturn ".var_export(['dsn'=>'sqlite:'.$dbPath,'database_path'=>$dbPath,'app_key'=>$appKey,'installed_at'=>date(DATE_ATOM)],true).";\n";
      if (file_put_contents(__DIR__.'/app/config.php',$config,LOCK_EX)===false) throw new RuntimeException('امکان ذخیره تنظیمات نیست. مجوز پوشه app را بررسی کنید.'); chmod(__DIR__.'/app/config.php',0600);
      if (file_put_contents($lock,date(DATE_ATOM),LOCK_EX)===false) throw new RuntimeException('امکان قفل‌کردن نصب‌گر نیست. مجوز پوشه storage را بررسی کنید.'); chmod($lock,0600);
      $done=true;
    } catch(Throwable $e) { if(isset($pdo)&&$pdo instanceof PDO&&$pdo->inTransaction())$pdo->rollBack(); if(!empty($createdDb)&&isset($dbPath)&&is_file($dbPath)&&!is_file($lock))@unlink($dbPath); $error='نصب انجام نشد: '.htmlspecialchars($e->getMessage(),ENT_QUOTES,'UTF-8'); }
  }
}
?><!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>نصب Etebarami SMS Gateway</title><style>body{font:16px Tahoma;background:#f3f6fb;color:#182238;margin:0;padding:3vh 5vw}.box{max-width:680px;margin:auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 12px 50px #18223818}input{display:block;width:100%;box-sizing:border-box;padding:12px;margin:7px 0 14px;border:1px solid #ccd5e2;border-radius:8px}button{background:#1769e0;color:#fff;padding:12px 20px;border:0;border-radius:8px}.ok{color:#08754d}.err{color:#ad2635}</style><main class="box"><h1>نصب Etebarami SMS Gateway</h1><?php if($done): ?><h2 class="ok">نصب تکمیل شد</h2><p>Installer قفل شد. پایگاه‌دادهٔ SQLite و جدول‌ها به‌صورت خودکار ساخته شدند؛ حالا وارد پنل شوید.</p><p><a href="index.php">ورود به پنل</a></p><?php else: ?><h3>بررسی سازگاری</h3><ul><?php foreach($checks as $name=>$ok): ?><li class="<?=$ok?'ok':'err'?>"><?=htmlspecialchars($name)?>: <?=$ok?'آماده':'نیازمند اصلاح'?></li><?php endforeach ?></ul><?php if($error): ?><p class="err"><?=$error?></p><?php endif ?><form method="post"><p>پایگاه‌دادهٔ امن محلی به‌صورت خودکار ساخته می‌شود؛ نیازی به اطلاعات MySQL یا cPanel ندارید.</p><label>نام کاربری مدیر<input name="username" required></label><label>رمز مدیر (حداقل ۱۲ کاراکتر)<input name="password" type="password" minlength="12" required></label><button>نصب و ایجاد جداول</button></form><?php endif ?></main></html>
