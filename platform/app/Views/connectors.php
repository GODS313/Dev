<h1>کانکتورهای پیام‌رسان</h1>
<section class="card">
  <h2>اتصال ربات جدید</h2>
  <p class="muted">فقط از API رسمی ربات هر پیام‌رسان استفاده می‌شود. توکن ربات رمزنگاری‌شده روی سرور ذخیره می‌شود و دیگر نمایش داده نمی‌شود.</p>
  <form method="post" action="/admin/connectors" class="grid" autocomplete="off">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <label>پیام‌رسان
      <select name="type"><?php foreach ($types as $t): ?><option value="<?= $e($t->type()) ?>"><?= $e($t->label()) ?></option><?php endforeach; ?></select>
    </label>
    <label>نام دلخواه <input name="name" placeholder="مثلاً ربات فروش"></label>
    <label>توکن ربات (از BotFather) <input name="secret" type="password" required dir="ltr"></label>
    <button>اتصال و بررسی</button>
  </form>
  <?php if (!$secure): ?><p class="muted">سایت هنوز روی HTTPS باز نشده؛ دریافت پیام‌ها تا فعال شدن SSL از طریق Cron انجام می‌شود.</p><?php endif; ?>
</section>
<div class="table"><table>
<tr><th>#</th><th>پیام‌رسان</th><th>نام</th><th>اعضای فعال</th><th>دریافت پیام</th><th>وضعیت</th><th></th></tr>
<?php foreach ($connectors as $c): ?>
<tr>
  <td><?= (int) $c['id'] ?></td>
  <td><?= $e(isset($types[$c['type']]) ? $types[$c['type']]->label() : $c['type']) ?></td>
  <td><?= $e($c['name']) ?></td>
  <td><?= (int) $c['subscribers'] ?></td>
  <td><?= $c['webhook_active'] ? 'وب‌هوک' : 'Cron' ?></td>
  <td><?= $c['enabled'] ? 'فعال' : 'غیرفعال' ?></td>
  <td class="actions">
    <?php foreach (['webhook' => 'فعال‌سازی وب‌هوک', 'polling' => 'دریافت با Cron', 'toggle' => $c['enabled'] ? 'غیرفعال' : 'فعال', 'delete' => 'حذف'] as $act => $label): ?>
      <form method="post" action="/admin/connectors/<?= (int) $c['id'] ?>/<?= $act ?>" class="inline"<?= $act === 'delete' ? ' data-confirm' : '' ?>>
        <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>"><button class="sm<?= $act === 'delete' ? ' danger' : '' ?>"><?= $label ?></button>
      </form>
    <?php endforeach; ?>
  </td>
</tr>
<?php endforeach; ?>
<?php if (!$connectors): ?><tr><td colspan="7" class="muted">هنوز کانکتوری وصل نشده.</td></tr><?php endif; ?>
</table></div>
