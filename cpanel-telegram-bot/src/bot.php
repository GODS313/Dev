<?php
declare(strict_types=1);
$config = require dirname(__DIR__) . '/storage/config.php';
function telegram(string $method, array $data, string $token): array {
    $ch = curl_init("https://api.telegram.org/bot{$token}/{$method}");
    curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>http_build_query($data),CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>20]);
    $out=curl_exec($ch); curl_close($ch);
    $json=json_decode((string)$out,true); return is_array($json)?$json:['ok'=>false];
}
$update=json_decode(file_get_contents('php://input') ?: '',true);
if(is_array($update) && isset($update['message'])) {
    $message=$update['message']; $chatId=(string)($message['chat']['id']??''); $text=trim((string)($message['text']??''));
    if($chatId && in_array($text,['/start','/help'],true)) telegram('sendMessage',['chat_id'=>$chatId,'text'=>"سلام 👋\nربات با موفقیت فعال است."],$config['bot_token']);
}
header('Content-Type: application/json; charset=utf-8'); echo json_encode(['ok'=>true]);
