<h1>کاربران</h1>
<section class="card">
  <h2>افزودن کاربر</h2>
  <form method="post" action="/admin/users" class="grid">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <label>نام <input name="name" required></label>
    <label>تلفن <input name="phone" dir="ltr"></label>
    <label>ایمیل <input name="email" type="email" dir="ltr"></label>
    <label>برچسب‌ها <input name="tags" placeholder="vip, تهران"></label>
    <label class="check"><input type="checkbox" name="consent" value="1"> رضایت دریافت پیام را داده است</label>
    <button>افزودن</button>
  </form>
</section>
<form method="get" class="search"><input name="q" value="<?= $e($q) ?>" placeholder="جستجو در نام، تلفن، برچسب"><button>جستجو</button></form>
<div class="table"><table>
<tr><th>#</th><th>نام</th><th>تلفن</th><th>رضایت</th><th>عضویت فعال</th><th>دستگاه</th><th>برچسب‌ها</th><th></th></tr>
<?php foreach ($users as $u): ?>
<tr>
  <td><?= (int) $u['id'] ?></td>
  <td><?= $e($u['display_name']) ?></td>
  <td dir="ltr"><?= $e($u['phone'] ?? '') ?></td>
  <td><?= $u['consent'] ? '✓' : '—' ?></td>
  <td><?= (int) $u['subscriptions'] ?></td>
  <td><?= (int) $u['device_count'] ?></td>
  <td>
    <form method="post" action="/admin/users/<?= (int) $u['id'] ?>/tags" class="inline">
      <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
      <input name="tags" value="<?= $e($u['tags']) ?>" class="sm"><button class="sm">ذخیره</button>
    </form>
  </td>
  <td>
    <form method="post" action="/admin/users/<?= (int) $u['id'] ?>/delete" class="inline" data-confirm>
      <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>"><button class="sm danger">حذف</button>
    </form>
  </td>
</tr>
<?php endforeach; ?>
<?php if (!$users): ?><tr><td colspan="8" class="muted">کاربری ثبت نشده. کاربران با زدن /start در ربات هم خودکار اضافه می‌شوند.</td></tr><?php endif; ?>
</table></div>
