<h1>نشست‌های فعال</h1>
<div class="table"><table>
<tr><th>#</th><th>نوع</th><th>صاحب نشست</th><th>IP</th><th>مرورگر/اپ</th><th>شروع</th><th>آخرین فعالیت</th><th>انقضا</th><th></th></tr>
<?php foreach ($sessions as $s): ?>
<tr>
  <td><?= (int) $s['id'] ?></td>
  <td><?= $s['subject_type'] === 'admin' ? 'مدیر' : 'دستگاه' ?></td>
  <td dir="ltr"><?= $e($s['subject_type'] === 'admin' ? $s['admin_name'] : $s['device_uid']) ?></td>
  <td dir="ltr"><?= $e($s['ip'] ?? '') ?></td>
  <td class="clip" dir="ltr"><?= $e($s['user_agent'] ?? '') ?></td>
  <td><?= $e($local($s['created_at'])) ?></td><td><?= $e($local($s['last_seen_at'])) ?></td><td><?= $e($local($s['expires_at'])) ?></td>
  <td>
    <?php if ((int) $s['id'] === $current): ?><span class="muted">نشست فعلی</span><?php else: ?>
    <form method="post" action="/admin/sessions/<?= (int) $s['id'] ?>/revoke" class="inline">
      <input type="hidden" name="_csrf" value="<?= $e($csrf) ?>"><button class="sm danger">لغو</button>
    </form>
    <?php endif; ?>
  </td>
</tr>
<?php endforeach; ?>
</table></div>
