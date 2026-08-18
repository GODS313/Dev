<?php
declare(strict_types=1);

const CANONICAL_URL = 'https://adlisho.online/download';
header('Cache-Control: no-store');
header('Location: ' . CANONICAL_URL, true, 301);
exit;
