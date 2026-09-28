<?php
declare(strict_types=1);
require __DIR__.'/app/common.php';

header('Content-Type: application/json; charset=utf-8');
if (($_SERVER['REQUEST_METHOD']??'GET')!=='POST') { http_response_code(405); echo '{"ok":false}'; exit; }
$cfg=telegram_settings();
$provided=(string)($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN']??'');
if ($cfg['token']==='' || $cfg['chat_id']==='' || $cfg['webhook_secret']==='' || !hash_equals($cfg['webhook_secret'],$provided)) { http_response_code(403); echo '{"ok":false}'; exit; }
$raw=file_get_contents('php://input');
if ($raw===false || strlen($raw)>1048576) { http_response_code(413); echo '{"ok":false}'; exit; }
$update=json_decode($raw,true);
if (!is_array($update) || !isset($update['update_id'])) { http_response_code(400); echo '{"ok":false}'; exit; }
$pdo=db();
$insert=$pdo->prepare('INSERT OR IGNORE INTO telegram_updates(update_id,processed_at) VALUES(?,CURRENT_TIMESTAMP)');
$insert->execute([(int)$update['update_id']]);
if ($insert->rowCount()===0) { echo '{"ok":true}'; exit; }
try {
    if (isset($update['callback_query'])) handle_callback($update['callback_query'],$cfg['chat_id']);
    elseif (isset($update['message'])) handle_message($update['message'],$cfg['chat_id']);
    telegram_log('webhook_update','success','update '.(int)$update['update_id']);
} catch (Throwable $e) {
    telegram_log('webhook_update','failed',substr($e->getMessage(),0,300));
    try { send_bot($cfg['chat_id'],'دستور انجام نشد: '.$e->getMessage()); } catch(Throwable $ignored) {}
}
echo '{"ok":true}';

function handle_message(array $m,string $adminChat): void {
    $chat=$m['chat']??[]; $chatId=(string)($chat['id']??'');
    if (($chat['type']??'')!=='private' || $chatId!==$adminChat) return;
    if (isset($m['photo']) && is_array($m['photo'])) { save_photo($m,$chatId); return; }
    $text=trim((string)($m['text']??''));
    if ($text==='' ) return;
    if (str_starts_with($text,'/start') || str_starts_with($text,'/menu')) { clear_flow($chatId); send_menu($chatId,"پنل Etebarami آماده است. یکی از گزینه‌ها را انتخاب کن."); return; }
    if ($text==='/cancel' || $text==='لغو') { clear_flow($chatId); send_menu($chatId,'عملیات لغو شد.'); return; }
    if (in_array($text,['📡 وضعیت / Ping','Ping','وضعیت دستگاه‌ها'],true)) { clear_flow($chatId); show_gateways($chatId); return; }
    if (in_array($text,['✉️ ارسال SMS','ارسال SMS','Send SMS'],true)) { set_flow($chatId,'sms_phone',[]); send_bot($chatId,'شمارهٔ گیرنده را وارد کن. فقط مخاطب دارای رضایت ثبت‌شده و خارج از Blocklist پذیرفته می‌شود. برای خروج /cancel را بزن.'); return; }
    if (in_array($text,['📥 Inbox','اینباکس','Inbox'],true)) { clear_flow($chatId); show_inbox($chatId); return; }
    if (in_array($text,['📊 کمپین‌ها','کمپین‌ها'],true)) { clear_flow($chatId); show_campaigns($chatId); return; }
    if (in_array($text,['🖼 گالری','گالری','Gallery'],true)) { clear_flow($chatId); show_gallery($chatId); return; }
    if (in_array($text,['راهنما','❔ راهنما'],true)) { send_menu($chatId,"برای ذخیرهٔ عکس، عکس را یک‌بار از گالری گوشی در همین گفت‌وگو برای بات بفرست. سپس از «گالری» آن را دوباره در تلگرام دریافت و در صورت نیاز به گفت‌وگوی دیگر فوروارد کن.\n\nبرای SMS، گیرنده باید در پنل به‌عنوان دارای رضایت ثبت شده باشد."); return; }
    $flow=get_flow($chatId);
    if ($flow['state']==='sms_phone') { accept_phone($chatId,$text); return; }
    if ($flow['state']==='sms_body') { accept_sms_body($chatId,$text,$flow['data']); return; }
    send_menu($chatId,'این دستور را نشناختم. از دکمه‌های منو استفاده کن.');
}

function handle_callback(array $cb,string $adminChat): void {
    $chatId=(string)($cb['message']['chat']['id']??'');
    if ($chatId!==$adminChat || ($cb['message']['chat']['type']??'')!=='private') { answer_callback((string)($cb['id']??''),'دسترسی مجاز نیست.'); return; }
    $data=(string)($cb['data']??''); $flow=get_flow($chatId);
    if ($data==='sms:cancel') { clear_flow($chatId); answer_callback((string)$cb['id'],'لغو شد'); send_menu($chatId,'ارسال لغو شد.'); return; }
    if (preg_match('/^sms:gateway:([0-9]+)$/',$data,$match)) {
        if ($flow['state']!=='sms_choose_gateway') { answer_callback((string)$cb['id'],'این انتخاب منقضی شده است.'); return; }
        $gid=(int)$match[1]; $dataArray=$flow['data']; $dataArray['gateway_id']=$gid;
        $q=db()->prepare("SELECT name FROM gateways WHERE id=? AND enabled=1 AND status='online' AND last_seen>=datetime('now','-180 seconds')"); $q->execute([$gid]); $name=$q->fetchColumn();
        if(!$name) { clear_flow($chatId); answer_callback((string)$cb['id'],'گیت‌وی دیگر آنلاین نیست.'); show_gateways($chatId); return; }
        set_flow($chatId,'sms_confirm',$dataArray); answer_callback((string)$cb['id']);
        $keyboard=['inline_keyboard'=>[[['text'=>'✅ تأیید و ارسال','callback_data'=>'sms:confirm'],['text'=>'لغو','callback_data'=>'sms:cancel']]]];
        send_bot($chatId,"تأیید ارسال SMS\nدستگاه: $name\nگیرنده: ".$dataArray['phone']."\n\nمتن:\n".$dataArray['body'], $keyboard); return;
    }
    if ($data==='sms:confirm') {
        if ($flow['state']!=='sms_confirm') { answer_callback((string)$cb['id'],'این درخواست منقضی شده است.'); return; }
        answer_callback((string)$cb['id'],'در حال ثبت در صف…');
        $result=queue_sms($flow['data']); clear_flow($chatId);
        send_menu($chatId,$result); return;
    }
    if (preg_match('/^media:delete:([0-9]+)$/',$data,$match)) {
        db()->prepare('DELETE FROM media_library WHERE id=?')->execute([(int)$match[1]]);
        answer_callback((string)$cb['id'],'از فهرست گالری حذف شد.'); send_bot($chatId,'مرجع این تصویر از گالری بات حذف شد.'); return;
    }
    if (preg_match('/^media:([0-9]+)$/',$data,$match)) { answer_callback((string)$cb['id']); send_media((int)$match[1],$chatId); return; }
    answer_callback((string)($cb['id']??''),'گزینه منقضی یا نامعتبر است.');
}

function send_menu(string $chat,string $text): void {
    $keyboard=['keyboard'=>[[['text'=>'📡 وضعیت / Ping'],['text'=>'✉️ ارسال SMS']],[['text'=>'📥 Inbox'],['text'=>'📊 کمپین‌ها']],[['text'=>'🖼 گالری'],['text'=>'❔ راهنما']]],'resize_keyboard'=>true,'is_persistent'=>true];
    send_bot($chat,$text,$keyboard);
}

function show_gateways(string $chat): void {
    $rows=db()->query("SELECT name,phone_number,device_model,android_version,app_version,status,last_seen FROM gateways WHERE enabled=1 ORDER BY id DESC LIMIT 12")->fetchAll();
    if(!$rows) { send_bot($chat,'هنوز Gateway ثبت نشده است.'); return; }
    $lines=['📡 وضعیت گوشی‌ها:'];
    foreach($rows as $g) {
        $online=$g['status']==='online' && !empty($g['last_seen']) && strtotime((string)$g['last_seen'].' UTC')>=time()-180;
        $lines[]=($online?'🟢 آنلاین':'⚪ آفلاین').' '.$g['name'].' | '.($g['phone_number']?:'شماره ثبت نشده');
        $meta=array_filter([$g['device_model'],$g['android_version']?'Android '.$g['android_version']:null,$g['app_version']?'App '.$g['app_version']:null]);
        if($meta)$lines[]='   '.implode(' · ',$meta);
        if(!empty($g['last_seen']))$lines[]='   آخرین ارتباط: '.$g['last_seen'];
    }
    send_bot($chat,implode("\n",$lines));
}

function show_inbox(string $chat): void {
    $rows=db()->query('SELECT i.phone,i.body,i.received_at,g.name gateway_name FROM sms_inbox i LEFT JOIN gateways g ON g.id=i.gateway_id ORDER BY i.id DESC LIMIT 8')->fetchAll();
    if(!$rows) { send_bot($chat,'📥 اینباکس فعلاً خالی است. برای ثبت پیام‌های دریافتی، Gateway باید مجوز RECEIVE_SMS داشته باشد و نسخهٔ اپ آن‌ها را Sync کند.'); return; }
    $lines=['📥 آخرین پیام‌های دریافتی:'];
    foreach($rows as $r) $lines[]="\n".($r['received_at']?:'زمان نامشخص').' | '.($r['gateway_name']?:'گوشی').'\nاز: '.$r['phone'].'\n'.tg_substr((string)$r['body'],0,280);
    send_bot($chat,implode("\n",$lines));
}

function show_campaigns(string $chat): void {
    $rows=db()->query("SELECT c.id,c.title,c.status,COUNT(j.id) total,SUM(j.status='queued') queued,SUM(j.status='processing') processing,SUM(j.status IN ('sent','delivered')) sent,SUM(j.status='failed') failed FROM campaigns c LEFT JOIN sms_jobs j ON j.campaign_id=c.id GROUP BY c.id ORDER BY c.id DESC LIMIT 8")->fetchAll();
    if(!$rows) { send_bot($chat,'هنوز کمپینی ثبت نشده است.'); return; }
    $lines=['📊 آخرین کمپین‌ها:'];
    foreach($rows as $r) $lines[]='• '.$r['title'].' | '.$r['status'].' | کل '.(int)$r['total'].' | صف '.(int)$r['queued'].' | ارسال '.(int)$r['sent'].' | خطا '.(int)$r['failed'];
    send_bot($chat,implode("\n",$lines));
}

function accept_phone(string $chat,string $raw): void {
    $phone=normalize_phone($raw);
    if(!$phone) { send_bot($chat,'شماره معتبر نیست. نمونه: 09123456789'); return; }
    $q=db()->prepare('SELECT 1 FROM blocklist WHERE phone=?'); $q->execute([$phone]); if($q->fetchColumn()) { send_bot($chat,'این شماره در Blocklist است و پیام برای آن صف نمی‌شود.'); return; }
    $q=db()->prepare("SELECT 1 FROM contacts WHERE phone=? AND consent_status='opted_in'"); $q->execute([$phone]); if(!$q->fetchColumn()) { send_bot($chat,'این شماره با رضایت دریافت پیام در فهرست مخاطبان ثبت نشده است. ابتدا آن را در پنل ثبت و رضایت را تأیید کن.'); return; }
    set_flow($chat,'sms_body',['phone'=>$phone]); send_bot($chat,'متن SMS را بفرست. پیام پیش از ورود به صف برای تأیید نهایی نمایش داده می‌شود.');
}

function accept_sms_body(string $chat,string $body,array $data): void {
    $body=trim($body);
    if($body==='' || tg_length($body)>2000) { send_bot($chat,'متن خالی است یا از حد ۲۰۰۰ نویسه بیشتر شده است. متن را دوباره بفرست.'); return; }
    $q=db()->query("SELECT id,name,phone_number FROM gateways WHERE enabled=1 AND status='online' AND last_seen>=datetime('now','-180 seconds') ORDER BY id DESC LIMIT 12"); $gateways=$q->fetchAll();
    if(!$gateways) { clear_flow($chat); send_bot($chat,'هیچ گوشی آنلاین نیست؛ SMS در صف قرار نگرفت.'); return; }
    $data['body']=$body; set_flow($chat,'sms_choose_gateway',$data);
    $buttons=[]; foreach($gateways as $g) $buttons[]=[['text'=>'📱 '.$g['name'].' '.($g['phone_number']??''),'callback_data'=>'sms:gateway:'.(int)$g['id']]];
    $buttons[]=[['text'=>'لغو','callback_data'=>'sms:cancel']];
    send_bot($chat,'گیت‌وی آنلاین را برای این SMS انتخاب کن.',['inline_keyboard'=>$buttons]);
}

function queue_sms(array $data): string {
    $phone=normalize_phone((string)($data['phone']??'')); $body=trim((string)($data['body']??'')); $gid=(int)($data['gateway_id']??0);
    if(!$phone || $body==='' || !$gid) return 'اطلاعات ارسال ناقص است؛ از ابتدا شروع کن.';
    $pdo=db(); $q=$pdo->prepare('SELECT 1 FROM blocklist WHERE phone=?'); $q->execute([$phone]); if($q->fetchColumn())return 'شماره در Blocklist است؛ ارسال لغو شد.';
    $q=$pdo->prepare("SELECT 1 FROM contacts WHERE phone=? AND consent_status='opted_in'"); $q->execute([$phone]); if(!$q->fetchColumn())return 'رضایت ثبت‌شده پیدا نشد؛ ارسال لغو شد.';
    $q=$pdo->prepare("SELECT 1 FROM gateways WHERE id=? AND enabled=1 AND status='online' AND last_seen>=datetime('now','-180 seconds')"); $q->execute([$gid]); if(!$q->fetchColumn())return 'گیت‌وی آفلاین شد؛ پیام در صف قرار نگرفت.';
    $pdo->beginTransaction();
    try {
        $title='Telegram SMS '.gmdate('Y-m-d H:i:s');
        $pdo->prepare("INSERT INTO campaigns(title,body,gateway_id,status,test_mode,created_at,started_at) VALUES(?,?,?,'running',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")->execute([$title,$body,$gid]);
        $cid=(int)$pdo->lastInsertId(); $uuid=bin2hex(random_bytes(16)); $key=bin2hex(random_bytes(16));
        $pdo->prepare("INSERT INTO sms_jobs(job_uuid,campaign_id,gateway_id,phone,body,status,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")->execute([$uuid,$cid,$gid,$phone,$body,$key]);
        $job=(int)$pdo->lastInsertId(); $pdo->prepare("INSERT INTO sms_events(job_id,event_type,created_at) VALUES(?,'queued',CURRENT_TIMESTAMP)")->execute([$job]);
        $pdo->commit(); audit('telegram_sms_queued',['campaign_id'=>$cid,'gateway_id'=>$gid,'job_id'=>$job]);
        return "✅ SMS در صف گوشی قرار گرفت.\nشناسهٔ Job: $job\nگیرنده: $phone";
    } catch(Throwable $e) { if($pdo->inTransaction())$pdo->rollBack(); throw $e; }
}

function save_photo(array $m,string $chat): void {
    $photos=$m['photo']; $best=end($photos); if(!is_array($best)||empty($best['file_id'])) { send_bot($chat,'فایل تصویر از تلگرام قابل دریافت نیست.'); return; }
    $title=trim((string)($m['caption']??'')); if($title==='')$title='تصویر '.date('Y-m-d H:i');
    $q=db()->prepare('INSERT OR IGNORE INTO media_library(file_id,file_unique_id,title,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)');
    $q->execute([(string)$best['file_id'],(string)($best['file_unique_id']??''),tg_substr($title,0,160),'image/jpeg',(int)($best['file_size']??0)]);
    send_menu($chat,$q->rowCount()?'🖼 تصویر در گالری ابری خصوصی ذخیره شد؛ لازم نیست برای استفادهٔ دوباره از گوشی بارگذاری‌اش کنی. برای دیدن و بازیابی آن «گالری» را بزن.':'این تصویر قبلاً ذخیره شده است؛ از «گالری» انتخابش کن.');
}

function show_gallery(string $chat): void {
    $rows=db()->query('SELECT id,title,created_at FROM media_library ORDER BY id DESC LIMIT 10')->fetchAll();
    if(!$rows) { send_bot($chat,'گالری هنوز خالی است. در همین گفت‌وگو یک یا چند عکس را از گالری گوشی برای بات بفرست تا یک‌بار ذخیره شوند.'); return; }
    $keyboard=[]; foreach($rows as $r)$keyboard[]=[['text'=>'🖼 '.tg_substr($r['title'],0,48),'callback_data'=>'media:'.(int)$r['id']]];
    send_bot($chat,'🖼 تصاویر ذخیره‌شده (برای فرستادن دوباره در همین گفت‌وگو انتخاب کن):',['inline_keyboard'=>$keyboard]);
}

function send_media(int $id,string $chat): void {
    $q=db()->prepare('SELECT file_id,title FROM media_library WHERE id=?'); $q->execute([$id]); $media=$q->fetch();
    if(!$media) { send_bot($chat,'این تصویر پیدا نشد؛ فهرست گالری را تازه کن.'); return; }
    telegram_api('sendPhoto',['chat_id'=>$chat,'photo'=>$media['file_id'],'caption'=>tg_substr($media['title'],0,900),'reply_markup'=>['inline_keyboard'=>[[['text'=>'حذف از فهرست گالری','callback_data'=>'media:delete:'.$id]]]]]);
}

function get_flow(string $chat): array { $q=db()->prepare('SELECT state,data_json FROM telegram_flows WHERE chat_id=?'); $q->execute([$chat]); $r=$q->fetch(); return $r?['state'=>$r['state'],'data'=>(json_decode($r['data_json'],true)?:[])]:['state'=>'','data'=>[]]; }
function set_flow(string $chat,string $state,array $data): void { db()->prepare('INSERT INTO telegram_flows(chat_id,state,data_json,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(chat_id) DO UPDATE SET state=excluded.state,data_json=excluded.data_json,updated_at=CURRENT_TIMESTAMP')->execute([$chat,$state,json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)]); }
function clear_flow(string $chat): void { db()->prepare('DELETE FROM telegram_flows WHERE chat_id=?')->execute([$chat]); }
function send_bot(string $chat,string $text,array $markup=[]): void { $params=['chat_id'=>$chat,'text'=>tg_substr($text,0,4000)]; if($markup)$params['reply_markup']=$markup; telegram_api('sendMessage',$params); }
function answer_callback(string $id,string $text=''): void { if($id!=='') telegram_api('answerCallbackQuery',['callback_query_id'=>$id,'text'=>$text]); }
function telegram_log(string $event,string $result,string $detail): void { try { db()->prepare('INSERT INTO telegram_logs(event_type,result,detail,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP)')->execute([substr($event,0,80),substr($result,0,20),substr($detail,0,500)]); } catch(Throwable $ignored) {} }
function tg_chars(string $text): array { return preg_split('//u',$text,-1,PREG_SPLIT_NO_EMPTY)?:str_split($text); }
function tg_length(string $text): int { return count(tg_chars($text)); }
function tg_substr(string $text,int $start,int $length): string { return implode('',array_slice(tg_chars($text),$start,$length)); }
