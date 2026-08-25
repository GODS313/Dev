<?php
declare(strict_types=1); session_start();
$base=dirname(__DIR__); $configFile=$base.'/storage/config.php'; $config=require $configFile;
function e(string $s):string{return htmlspecialchars($s,ENT_QUOTES,'UTF-8');}
function saveConfig(string $file,array $c):void{file_put_contents($file,"<?php\nreturn ".var_export($c,true).";\n",LOCK_EX); @chmod($file,0600);}
if(isset($_GET['logout'])){session_destroy();header('Location: /admin');exit;}
if(empty($_SESSION['admin_ok'])){
 $error=''; if($_SERVER['REQUEST_METHOD']==='POST' && password_verify((string)($_POST['password']??''),$config['admin_password_hash'])){session_regenerate_id(true);$_SESSION['admin_ok']=true;header('Location: /admin');exit;}
 if($_SERVER['REQUEST_METHOD']==='POST')$error='رمز عبور اشتباه است.';
 echo '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><style>body{font-family:tahoma;background:#f5f6fa}.box{max-width:430px;margin:90px auto;background:#fff;padding:28px;border-radius:18px}input,button{width:100%;box-sizing:border-box;padding:12px;margin-top:10px;border-radius:8px}button{background:#222;color:#fff;border:0}</style><div class="box"><h2>ورود مدیریت</h2>'.($error?'<p style="color:#b00">'.e($error).'</p>':'').'<form method="post"><input type="password" name="password" placeholder="رمز پنل" required><button>ورود</button></form></div>'; exit;
}
$message='';
if($_SERVER['REQUEST_METHOD']==='POST' && isset($_POST['save'])){ $token=trim((string)($_POST['bot_token']??'')); $chatId=trim((string)($_POST['chat_id']??'')); if($token==='')$message='Bot Token خالی است.'; else{$config['bot_token']=$token;$config['chat_id']=$chatId;saveConfig($configFile,$config);$message='تنظیمات ذخیره شد.';} }
if($_SERVER['REQUEST_METHOD']==='POST' && isset($_POST['test'])){ $ch=curl_init("https://api.telegram.org/bot{$config['bot_token']}/getMe");curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>10]);$r=json_decode((string)curl_exec($ch),true);curl_close($ch);$message=!empty($r['ok'])?'اتصال به Telegram موفق بود.':'اتصال ناموفق بود؛ Token را بررسی کنید.'; }
?>
<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>پنل مدیریت</title><style>body{font-family:tahoma;background:#f5f6fa}.box{max-width:760px;margin:45px auto;background:#fff;padding:30px;border-radius:18px}input{width:100%;box-sizing:border-box;padding:12px;margin:8px 0 18px;border:1px solid #ddd;border-radius:8px}button,a{padding:11px 16px;border:0;border-radius:8px;text-decoration:none;display:inline-block;margin-left:8px}button{background:#222;color:#fff}.secondary{background:#eee;color:#222}.msg{padding:12px;background:#edf8ed;border-radius:8px;margin-bottom:18px}</style><div class="box"><h1>پنل مدیریت ربات</h1><?php if($message)echo '<div class="msg">'.e($message).'</div>'; ?><form method="post"><label>Bot Token</label><input type="password" name="bot_token" value="<?=e($config['bot_token'])?>" autocomplete="off" required><label>Chat ID</label><input name="chat_id" value="<?=e($config['chat_id'])?>"><button name="save" value="1">ذخیره</button><button name="test" value="1" class="secondary">تست اتصال</button><a class="secondary" href="?logout=1">خروج</a></form></div>
