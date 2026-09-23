<h1>حساب من</h1>
<section class="card">
  <h2>تغییر رمز عبور</h2>
  <form method="post" action="/admin/account" class="grid">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <label>رمز فعلی <input name="current_password" type="password" required autocomplete="current-password"></label>
    <label>رمز جدید (حداقل ۱۰ کاراکتر) <input name="new_password" type="password" minlength="10" required autocomplete="new-password"></label>
    <button>تغییر رمز</button>
  </form>
  <p class="muted">بعد از تغییر رمز، همه نشست‌های شما لغو می‌شود و باید دوباره وارد شوید.</p>
</section>
