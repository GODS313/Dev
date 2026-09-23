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
<tr><th>#</th><th>پیام‌رسان</th><th>نام</th><th>اعضای فعال</th><th>گروه/کانال</th><th>دریافت پیام</th><th>وضعیت</th><th></th></tr>
<?php foreach ($connectors as $c): ?>
<tr>
  <td><?= (int) $c['id'] ?></td>
  <td><?= $e(isset($types[$c['type']]) ? $types[$c['type']]->label() : $c['type']) ?></td>
  <td><?= $e($c['name']) ?><?= !empty($c['bot_username']) ? '<br><span class="muted" dir="ltr">@' . $e($c['bot_username']) . '</span>' : '' ?></td>
  <td><?= (int) $c['subscribers'] ?></td>
  <td><?= (int) ($c['chats'] ?? 0) ?></td>
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
<?php if (!$connectors): ?><tr><td colspan="8" class="muted">هنوز کانکتوری وصل نشده.</td></tr><?php endif; ?>
</table></div>

<?php foreach ($connectors as $c): ?>
<section class="card">
  <h2><?= $e($c['name']) ?> — عضوگیری و پاسخ خودکار</h2>
  <div class="grid">
    <form method="post" action="/admin/connectors/<?= (int) $c['id'] ?>/join">
      <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
      <h3>دکمه عضویت در گروه‌ها و کانال‌ها</h3>
      <?php if (empty($c['bot_username'])): ?>
        <p class="muted">نام کاربری ربات هنوز مشخص نیست. یک بار کانکتور را حذف و دوباره وصل کنید.</p>
      <?php else: ?>
        <p class="muted">این پیام همراه یک دکمه به <b><?= (int) ($c['chats'] ?? 0) ?></b> گروه/کانالی که ربات در آن‌هاست فرستاده می‌شود. هر کس دکمه را بزند، ربات را استارت می‌کند و عضو اطلاع‌رسانی می‌شود.</p>
        <label>متن پیام <input name="join_text" value="برای دریافت اطلاع‌رسانی‌ها عضو شوید:"></label>
        <label>متن دکمه <input name="button_text" value="عضویت"></label>
        <button<?= (int) ($c['chats'] ?? 0) === 0 ? ' disabled' : '' ?>>ارسال به گروه‌ها/کانال‌ها</button>
      <?php endif; ?>
    </form>
    <form method="post" action="/admin/connectors/<?= (int) $c['id'] ?>/business">
      <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
      <h3>پاسخ خودکار اکانت شخصی (Business)</h3>
      <p class="muted">اگر این ربات را در تنظیمات Business اکانت تلگرام خود وصل کرده باشید، به هر مشتری که پیام می‌دهد یک بار در روز این پاسخ خودکار داده می‌شود. برای غیرفعال کردن، خالی بگذارید.</p>
      <label class="full">متن پاسخ خودکار <textarea name="business_reply" rows="3"><?= $e($c['business_reply'] ?? '') ?></textarea></label>
      <button>ذخیره پاسخ خودکار</button>
    </form>
  </div>
</section>
<?php endforeach; ?>
