<?php
declare(strict_types=1);
$root=$argv[1]??'';
if($root===''||!is_dir($root))throw new RuntimeException('Temporary app root is required');
$dbPath=$root.'/storage/api-test.sqlite';
@unlink($dbPath);
$pdo=new PDO('sqlite:'.$dbPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$pdo->exec('PRAGMA foreign_keys=ON');
$sql=file_get_contents($root.'/app/schema.sql');
foreach(array_filter(array_map('trim',explode(';',(string)$sql))) as $statement)$pdo->exec($statement);
// Model an installed version-2 database so the first API request exercises migration 3.
$pdo->exec('DROP TABLE gateway_enrollments');
$pdo->exec('PRAGMA user_version = 2');
$token='integration_test_gateway_token_0123456789abcd';
$pdo->prepare("INSERT INTO gateways(name,api_token_hash,status,last_seen,created_at) VALUES(?,?,'online',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")->execute(['Integration test',hash('sha256',$token)]);
$pdo->prepare("INSERT INTO settings(setting_key,setting_value,updated_at) VALUES('test_mode','1',CURRENT_TIMESTAMP)")->execute();
$config="<?php\nreturn ".var_export(['dsn'=>'sqlite:'.$dbPath,'database_path'=>$dbPath,'app_key'=>bin2hex(random_bytes(32))],true).";\n";
file_put_contents($root.'/app/config.php',$config,LOCK_EX);
chmod($root.'/app/config.php',0600);
file_put_contents($root.'/tests/api-test-token',$token,LOCK_EX);
echo "API test fixture ready\n";
