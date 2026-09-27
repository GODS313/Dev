<?php
declare(strict_types=1);
$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) { http_response_code(503); exit('ابتدا نصب را از install.php انجام دهید.'); }
$config = require $configFile;
$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
if (!$isHttps && PHP_SAPI !== 'cli') { http_response_code(400); exit('اتصال HTTPS الزامی است.'); }
ini_set('session.use_strict_mode', '1');
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_secure', $isHttps ? '1' : '0');
ini_set('session.cookie_samesite', 'Strict');
session_name('ete_sms_admin');
if (session_status() !== PHP_SESSION_ACTIVE) session_start();
function db(): PDO { static $pdo; global $config; if (!$pdo) $pdo = new PDO($config['dsn'], $config['db_user'], $config['db_pass'], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES=>false]); return $pdo; }
function e(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function csrf(): string { if (empty($_SESSION['csrf'])) $_SESSION['csrf']=bin2hex(random_bytes(32)); return $_SESSION['csrf']; }
function check_csrf(): void { if (!hash_equals($_SESSION['csrf'] ?? '', (string)($_POST['csrf'] ?? ''))) { http_response_code(419); exit('درخواست منقضی است؛ صفحه را تازه کنید.'); } }
function require_admin(): void { if (empty($_SESSION['admin_id'])) { header('Location: ../index.php'); exit; } }
function audit(string $action, array $meta=[]): void { $q=db()->prepare('INSERT INTO audit_logs(admin_id,action,details,ip,created_at) VALUES(?,?,?,?,NOW())'); $q->execute([$_SESSION['admin_id']??null,$action,json_encode($meta,JSON_UNESCAPED_UNICODE),substr($_SERVER['REMOTE_ADDR']??'',0,45)]); }
function enc(string $plain): string { global $config; $iv=random_bytes(12); $tag=''; $cipher=openssl_encrypt($plain,'aes-256-gcm',hex2bin($config['app_key']),OPENSSL_RAW_DATA,$iv,$tag); if ($cipher===false) throw new RuntimeException('Encryption failed'); return base64_encode($iv.$tag.$cipher); }
function dec(?string $sealed): string { global $config; if (!$sealed) return ''; $raw=base64_decode($sealed,true); if (!$raw || strlen($raw)<28) return ''; return (string)openssl_decrypt(substr($raw,28),'aes-256-gcm',hex2bin($config['app_key']),OPENSSL_RAW_DATA,substr($raw,0,12),substr($raw,12,16)); }
function json_out(array $data,int $status=200): never { http_response_code($status); header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store'); echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES); exit; }
function api_auth(): array { $h=$_SERVER['HTTP_AUTHORIZATION']??''; if (!preg_match('/^Bearer ([A-Za-z0-9_-]{32,128})$/',$h,$m)) json_out(['error'=>'unauthorized'],401); $q=db()->prepare('SELECT id,name,api_token_hash FROM gateways WHERE api_token_hash=? AND enabled=1'); $q->execute([hash('sha256',$m[1])]); $g=$q->fetch(); if (!$g) json_out(['error'=>'unauthorized'],401); return $g; }
function normalize_phone(string $n): ?string { $n=preg_replace('/[\s().-]+/u','',$n)??''; $n=preg_replace('/[^0-9+]/','',$n)??''; if (preg_match('/^09[0-9]{9}$/',$n)) return '+98'.substr($n,1); if (preg_match('/^\+989[0-9]{9}$/',$n)) return $n; if (preg_match('/^989[0-9]{9}$/',$n)) return '+'.$n; return null; }

function rate_limit(string $scope,int $limit,int $seconds): void { $key=hash('sha256',$scope.'|'.($_SERVER['REMOTE_ADDR']??'unknown')); $pdo=db(); $q=$pdo->prepare("INSERT INTO api_rate_limits(bucket_key,window_start,hits) VALUES(?,NOW(),1) ON DUPLICATE KEY UPDATE hits=IF(window_start < DATE_SUB(NOW(), INTERVAL ".$seconds." SECOND),1,hits+1),window_start=IF(window_start < DATE_SUB(NOW(), INTERVAL ".$seconds." SECOND),NOW(),window_start)"); $q->execute([$key]); $q=$pdo->prepare('SELECT hits FROM api_rate_limits WHERE bucket_key=?'); $q->execute([$key]); if((int)$q->fetchColumn()>$limit) json_out(['error'=>'rate_limited'],429); }
