<?php
declare(strict_types=1);

// Usage: php cli/admin.php create <username>   (password read from ADMIN_PASSWORD env)
//        php cli/admin.php passwd <username>
require dirname(__DIR__) . '/app/bootstrap.php';

use App\Core\Auth;
use App\Core\Database;

[$cmd, $user] = [$argv[1] ?? '', $argv[2] ?? ''];
$pass = (string) getenv('ADMIN_PASSWORD');
if ($user === '' || $pass === '' || !in_array($cmd, ['create', 'passwd'], true)) {
    fwrite(STDERR, "usage: ADMIN_PASSWORD=... php cli/admin.php create|passwd <username>\n");
    exit(1);
}
if ($cmd === 'create') {
    Auth::createAdmin($user, $pass);
} else {
    $id = Database::scalar('SELECT id FROM admins WHERE username = ?', [$user]);
    if (!$id) {
        fwrite(STDERR, "no such admin\n");
        exit(1);
    }
    Auth::setPassword((int) $id, $pass);
}
echo "ok\n";
