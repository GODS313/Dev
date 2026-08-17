<?php
declare(strict_types=1);

const RELEASE_URL = 'https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk';
header('Cache-Control: no-store');
header('Location: ' . RELEASE_URL, true, 302);
exit;
