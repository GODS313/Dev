<?php $labels = ['draft' => 'پیش‌نویس', 'scheduled' => 'زمان‌بندی‌شده', 'running' => 'در حال ارسال', 'paused' => 'متوقف', 'done' => 'پایان‌یافته']; ?>
<h1>کمپین‌ها</h1>
<section class="card">
  <h2>کمپین جدید</h2>
  <?php if (!$connectors): ?><p class="muted">اول یک کانکتور در صفحه «کانکتورها» وصل کنید.</p><?php else: ?>
  <form method="post" action="/admin/campaigns" class="grid">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <label>نام کمپین <input name="name" required></label>
    <label>کانکتور
      <select name="connector_id"><?php foreach ($connectors as $c): ?><option value="<?= (int) $c['id'] ?>"><?= $e($c['name']) ?> (<?= (int) $c['subscribers'] ?> عضو، <?= (int) ($c['chats'] ?? 0) ?> گروه/کانال)</option><?php endforeach; ?></select>
    </label>
    <label>مخاطب
      <select name="audience">
        <option value="subscribers">اعضای خصوصی (کسانی که /start زده‌اند)</option>
        <option value="groups">گروه‌ها و کانال‌هایی که ربات در آن‌هاست</option>
      </select>
    </label>
    <label>فقط کاربران با برچسب <input name="tag" placeholder="خالی = همه؛ فقط برای اعضای خصوصی"></label>
    <label>زمان ارسال <input name="scheduled_at" type="datetime-local"></label>
    <label class="full">متن پیام <textarea name="message" rows="5" required></textarea></label>
    <p class="muted full">حالت «اعضای خصوصی»: پیام فقط به کسانی می‌رسد که ربات را /start کرده‌اند و راهنمای لغو (/stop) به انتها اضافه می‌شود. حالت «گروه‌ها و کانال‌ها»: پیام داخل خود گروه/کانال منتشر می‌شود.</p>
    <button>ساخت پیش‌نویس</button>
  </form>
  <?php endif; ?>
</section>
<div class="table"><table>
<tr><th>#</th><th>نام</th><th>کانکتور</th><th>برچسب</th><th>وضعیت</th><th>ارسال/کل</th><th>ناموفق</th><th>زمان‌بندی</th><th></th></tr>
<?php foreach ($campaigns as $c): ?>
<tr>
  <td><?= (int) $c['id'] ?></td>
  <td title="<?= $e($c['message']) ?>"><?= $e($c['name']) ?></td>
  <td><?= $e($c['connector_name']) ?></td>
  <td><?= ($c['audience'] ?? 'subscribers') === 'groups' ? 'گروه/کانال' : ($e($c['tag_filter'] ?: 'همه اعضا')) ?></td>
  <td><span class="badge <?= $e($c['status']) ?>"><?= $labels[$c['status']] ?? $e($c['status']) ?></span></td>
  <td><?= (int) $c['sent'] ?> / <?= (int) $c['total'] ?></td>
  <td><?= (int) $c['failed'] ?></td>
  <td><?= $e($c['scheduled_at'] ?? '—') ?></td>
  <td class="actions">
    <?php $acts = in_array($c['status'], ['draft', 'paused'], true) ? ['start' => 'اجرا'] : (in_array($c['status'], ['running', 'scheduled'], true) ? ['pause' => 'توقف'] : []);
    if ($c['status'] !== 'running') { $acts['delete'] = 'حذف'; } ?>
    <?php foreach ($acts as $act => $label): ?>
      <form method="post" action="/admin/campaigns/<?= (int) $c['id'] ?>/<?= $act ?>" class="inline"<?= $act !== 'pause' ? ' data-confirm' : '' ?>>
        <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>"><button class="sm<?= $act === 'delete' ? ' danger' : '' ?>"><?= $label ?></button>
      </form>
    <?php endforeach; ?>
  </td>
</tr>
<?php endforeach; ?>
<?php if (!$campaigns): ?><tr><td colspan="9" class="muted">هنوز کمپینی ساخته نشده.</td></tr><?php endif; ?>
</table></div>
