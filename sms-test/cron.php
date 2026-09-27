<?php
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require __DIR__.'/app/common.php';$pdo=db();
// Test campaigns are simulated and can never reach the phone.
$jobs=$pdo->query("SELECT j.id,j.campaign_id FROM sms_jobs j JOIN campaigns c ON c.id=j.campaign_id WHERE j.status='queued' AND c.test_mode=1 LIMIT 200")->fetchAll();
foreach($jobs as $j){$pdo->prepare("UPDATE sms_jobs SET status='sent',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'")->execute([$j['id']]);$pdo->prepare("INSERT INTO sms_events(job_id,event_type,detail,created_at) VALUES(?,'sent','Test mode simulation',CURRENT_TIMESTAMP)")->execute([$j['id']]);}
$offlineBefore=gmdate('Y-m-d H:i:s',time()-180);$q=$pdo->prepare("SELECT id,name FROM gateways WHERE status='online' AND last_seen < ?");$q->execute([$offlineBefore]);$offline=$q->fetchAll();
foreach($offline as $g){$pdo->prepare("UPDATE gateways SET status='offline' WHERE id=?")->execute([$g['id']]);notify_telegram('gateway_offline','Gateway آفلاین شد: '.$g['name']);}
$endable=$pdo->query("SELECT id,title FROM campaigns WHERE status IN ('queued','running') AND NOT EXISTS (SELECT 1 FROM sms_jobs WHERE campaign_id=campaigns.id AND status IN ('queued','processing'))")->fetchAll();
foreach($endable as $c){$pdo->prepare("UPDATE campaigns SET status='completed',ended_at=CURRENT_TIMESTAMP WHERE id=?")->execute([$c['id']]);$q=$pdo->prepare('SELECT COUNT(*) total,SUM(status=\'sent\') sent,SUM(status=\'delivered\') delivered,SUM(status=\'failed\') failed,SUM(status=\'cancelled\') cancelled FROM sms_jobs WHERE campaign_id=?');$q->execute([$c['id']]);$r=$q->fetch();notify_telegram('campaign_completed','پایان کمپین '.$c['title'].' | کل '.$r['total'].' | ارسال '.$r['sent'].' | تحویل '.$r['delivered'].' | خطا '.$r['failed'].' | لغو '.$r['cancelled']);}
$pdo->prepare('DELETE FROM api_rate_limits WHERE window_start < ?')->execute([gmdate('Y-m-d H:i:s',time()-86400)]);
// A phone-side result may be lost; do not auto-send again. Mark stale processing as failed for review.
$pdo->prepare("UPDATE sms_jobs SET status='failed',error_text='No device result received before timeout',updated_at=CURRENT_TIMESTAMP WHERE status='processing' AND updated_at < ?")->execute([gmdate('Y-m-d H:i:s',time()-900)]);
echo 'simulated='.count($jobs).' offline='.count($offline).' completed='.count($endable).PHP_EOL;
