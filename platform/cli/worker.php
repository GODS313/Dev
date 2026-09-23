<?php
declare(strict_types=1);

// Cron entry: * * * * * php ~/platform/cli/worker.php
require dirname(__DIR__) . '/app/bootstrap.php';

$result = App\Core\Worker::tick();
echo $result === null ? "busy\n" : json_encode($result, JSON_UNESCAPED_UNICODE) . "\n";
