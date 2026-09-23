<form method="post" action="/admin/login" class="card login">
  <h1>ورود به پنل</h1>
  <?php if ($error): ?><div class="flash err"><?= $e($error) ?></div><?php endif; ?>
  <label>نام کاربری <input name="username" autocomplete="username" required autofocus></label>
  <label>رمز عبور <input name="password" type="password" autocomplete="current-password" required></label>
  <button>ورود</button>
</form>
