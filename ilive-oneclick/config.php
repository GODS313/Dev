<?php
declare(strict_types=1);
session_start(['cookie_httponly'=>true,'cookie_samesite'=>'Strict','cookie_secure'=>(!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off')]);
const DATA_FILE=__DIR__.'/data/settings.json';
const PASS_FILE=__DIR__.'/data/admin.pass';
function settings():array{$x=@file_get_contents(DATA_FILE);$d=$x?json_decode($x,true):null;return is_array($d)?$d:[];}
function save_settings(array $d):bool{$j=json_encode($d,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);return $j!==false&&file_put_contents(DATA_FILE,$j,LOCK_EX)!==false;}
function csrf():string{if(empty($_SESSION['csrf']))$_SESSION['csrf']=bin2hex(random_bytes(24));return $_SESSION['csrf'];}
function csrf_ok():bool{return isset($_POST['csrf'])&&hash_equals(csrf(),(string)$_POST['csrf']);}
function e(mixed $v):string{return htmlspecialchars((string)$v,ENT_QUOTES,'UTF-8');}
