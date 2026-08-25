<?php
declare(strict_types=1);
$base=dirname(__DIR__);$storage=$base.'/storage';$configFile=$storage.'/config.php';
if(is_file($configFile))exit('سیستم قبلاً نصب شده است. برای امنیت پوشه install را حذف کنید.');
$error='';
if($_SERVER['REQUEST_METHOD']==='POST'){
 $password=(string)($_POST['admin_password']??'');$token=trim((string)($_POST['bot_token']??''));$chatId=trim((string)($_POST['chat_id']??''));
 if(strlen($password)<8)$error='رمز پنل حداقل ۸ کاراکتر باشد.';elseif($token==='')$error='Bot Token را وارد کنید.';else{if(!is_dir($storage))mkdir($storage,0700,true);$config=['bot_token'=>$token,'chat_id'=>$chatId,'admin_password_hash'=>password_hash($password,PASSWORD_DEFAULT)];file_put_contents($configFile,"<?php\nreturn ".var_export($config,true).";\n",LOCK_EX);@chmod($configFile,0600);header('Location: /admin');exit;}
}
?><!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>نصب ربات</title><style>body{font-family:tahoma;background:#f5f6fa}.box{max-width:560px;margin:60px auto;background:#fff;padding:30px;border-radius:18px}input{width:100%;box-sizing:border-box;padding:12px;margin:8px 0 18px;border:1px solid #ddd;border-radius:8px}button{padding:12px 20px;background:#222;color:#fff;border:0;border-radius:8px}.err{color:#b00}</style><div class="box"><h1>نصب آسان ربات</h1><?php if($error)echo '<p class="err">'.htmlspecialchars($error,ENT_QUOTES,'UTF-8').'</p>'; ?><form method="post"><label>Bot Token</label><input name="bot_token" required><label>Chat ID</label><input name="chat_id"><label>رمز پنل مدیریت</label><input type="password" name="admin_password" minlength="8" required><button>نصب و ورود</button></form></div>
