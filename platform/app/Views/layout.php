<?php
$nav = [
    'dashboard' => ['/admin', 'داشبورد'],
    'users' => ['/admin/users', 'کاربران'],
    'devices' => ['/admin/devices', 'دستگاه‌ها'],
    'sessions' => ['/admin/sessions', 'نشست‌ها'],
    'connectors' => ['/admin/connectors', 'کانکتورها'],
    'campaigns' => ['/admin/campaigns', 'کمپین‌ها'],
    'tasks' => ['/admin/tasks', 'وظیفه‌ها'],
    'audit' => ['/admin/audit', 'گزارش رویدادها'],
    'account' => ['/admin/account', 'حساب من'],
];
?>
<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title><?= $e($nav[$view][1] ?? 'پنل') ?> · پنل مدیریت</title>
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/app.js" defer></script>
</head>
<body>
<header class="top">
  <strong>سامانه مدیریت و بازاریابی</strong>
  <nav>
    <?php foreach ($nav as $key => [$href, $label]): ?>
      <a href="<?= $href ?>"<?= $key === $view ? ' class="on"' : '' ?>><?= $label ?></a>
    <?php endforeach; ?>
  </nav>
  <form method="post" action="/admin/logout" class="inline">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <span class="muted"><?= $e($admin['username']) ?></span>
    <button class="link">خروج</button>
  </form>
</header>
<main>
<?php if (!empty($flash)): ?><div class="flash"><?= $e($flash) ?></div><?php endif; ?>
<?= $content ?>
</main>
</body>
</html>
