<?php $statusLabels = ['queued' => 'در صف', 'fetching' => 'دریافت', 'publishing' => 'در حال انتشار', 'delivering' => 'تحویل', 'done' => 'انجام شد', 'failed' => 'ناموفق', 'skipped' => 'تکراری — رد شد']; ?>
<h1>وظیفه‌ها</h1>
<p class="muted">هر وظیفه ماژول مستقل خودش را دارد: تنظیمات، فعال/غیرفعال، وضعیت و گزارش جدا. توکن‌ها و کلیدها رمزنگاری‌شده ذخیره می‌شوند و در گزارش‌ها نمایش داده نمی‌شوند.</p>

<?php foreach ($tasks as $key => $task): $st = $settings[$key]; $v = $st['values']; ?>
<section class="card">
  <h2><?= $e($task->label()) ?> <span class="badge <?= $st['enabled'] ? 'done' : '' ?>"><?= $st['enabled'] ? 'فعال' : 'غیرفعال' ?></span></h2>
  <form method="post" action="/admin/tasks/<?= $e($key) ?>/settings" class="grid" autocomplete="off">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <?php foreach ($task->fields() as $field => $meta): $secret = $meta['secret'] ?? false; ?>
      <label<?= ($meta['type'] ?? '') === 'textarea' ? ' class="full"' : '' ?>>
        <?= $e($meta['label']) ?>
        <?php if (($meta['type'] ?? '') === 'textarea'): ?>
          <textarea name="<?= $e($field) ?>" rows="3"><?= $secret ? '' : $e($v[$field] ?? '') ?></textarea>
        <?php else: ?>
          <input name="<?= $e($field) ?>" type="<?= $secret ? 'password' : $e($meta['type'] ?? 'text') ?>"
                 value="<?= $secret ? '' : $e($v[$field] ?? '') ?>"
                 placeholder="<?= $secret && $st['has_secret'] ? '••••• (ذخیره‌شده — برای تغییر وارد کنید)' : '' ?>"
                 <?= in_array($meta['type'] ?? '', ['url'], true) ? 'dir="ltr"' : '' ?>>
        <?php endif; ?>
        <?php if (!empty($meta['help'])): ?><small class="muted"><?= $e($meta['help']) ?></small><?php endif; ?>
      </label>
    <?php endforeach; ?>
    <label class="check"><input type="checkbox" name="enabled" value="1" <?= $st['enabled'] ? 'checked' : '' ?>> این وظیفه فعال باشد</label>
    <div class="full">
      <button>ذخیره تنظیمات</button>
    </div>
  </form>
  <?php if ($key === 'build_apk'): ?>
  <div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
    <h3>آپلود مستقیم فایل APK</h3>
    <p class="muted">اگر سرویس Build فایل را فقط به‌صورت فایل می‌دهد (نه لینک)، همان فایل را اینجا آپلود کنید تا خودکار روی سایت دانلود منتشر شود.</p>
    <form method="post" action="/admin/tasks/build_apk/upload" enctype="multipart/form-data" class="inline">
      <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
      <input type="file" name="apk" accept=".apk,application/vnd.android.package-archive" required>
      <button<?= $st['enabled'] ? '' : ' disabled' ?>>آپلود و انتشار</button>
    </form>
  </div>
  <?php endif; ?>
  <form method="post" action="/admin/tasks/<?= $e($key) ?>/run" class="inline" style="margin-top:10px">
    <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>">
    <button<?= $st['enabled'] ? '' : ' disabled' ?>>اجرا از روی آدرس اینترنتی</button>
    <?php if (!$st['enabled']): ?><span class="muted">برای اجرا اول فعالش کنید</span><?php endif; ?>
  </form>

  <h3>آخرین اجراها</h3>
  <div class="table"><table>
    <tr><th>#</th><th>وضعیت</th><th>نتیجه</th><th>زمان</th><th>گزارش</th></tr>
    <?php foreach ($runs[$key] as $r): $log = json_decode($r['log_json'] ?? '[]', true) ?: []; ?>
    <tr>
      <td><?= (int) $r['id'] ?></td>
      <td><span class="badge <?= $e($r['status']) ?>"><?= $statusLabels[$r['status']] ?? $e($r['status']) ?></span></td>
      <td dir="ltr"><?php if (!empty($r['result'])): ?><a href="<?= $e($r['result']) ?>" target="_blank" rel="noopener">لینک</a><?php else: ?>—<?php endif; ?></td>
      <td><?= $e($local($r['updated_at'])) ?></td>
      <td class="clip"><?= $e(implode(' · ', array_map(fn ($l) => is_array($l) ? ($l['m'] ?? '') : (string) $l, array_slice($log, -3)))) ?></td>
    </tr>
    <?php endforeach; ?>
    <?php if (!$runs[$key]): ?><tr><td colspan="5" class="muted">هنوز اجرایی ثبت نشده.</td></tr><?php endif; ?>
  </table></div>
</section>
<?php endforeach; ?>
