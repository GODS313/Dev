<h1>دستگاه‌ها</h1>
<section class="card">
  <h2>اتصال اپلیکیشن</h2>
  <p class="muted">اپ هنگام نصب، دستگاه را با این API ثبت می‌کند و یک توکن نشست ۹۰ روزه می‌گیرد.</p>
  <p>کلید API: <code><?= $e($apiKey) ?></code></p>
  <pre dir="ltr">POST <?= $e($base) ?>/api/v1/devices/register
X-Api-Key: &lt;کلید بالا&gt;
{"device_uid":"...","platform":"android","model":"...","app_version":"1.0"}

POST <?= $e($base) ?>/api/v1/devices/heartbeat
Authorization: Bearer &lt;token&gt;</pre>
</section>
<div class="table"><table>
<tr><th>#</th><th>شناسه دستگاه</th><th>پلتفرم</th><th>مدل</th><th>نسخه</th><th>کاربر</th><th>آخرین IP</th><th>آخرین فعالیت</th></tr>
<?php foreach ($devices as $d): ?>
<tr>
  <td><?= (int) $d['id'] ?></td><td dir="ltr"><?= $e($d['device_uid']) ?></td><td><?= $e($d['platform']) ?></td>
  <td><?= $e($d['model'] ?? '') ?></td><td><?= $e($d['app_version'] ?? '') ?></td><td><?= $e($d['display_name'] ?? '—') ?></td>
  <td dir="ltr"><?= $e($d['last_ip'] ?? '') ?></td><td><?= $e($local($d['last_seen_at'])) ?></td>
</tr>
<?php endforeach; ?>
<?php if (!$devices): ?><tr><td colspan="8" class="muted">هنوز دستگاهی ثبت نشده.</td></tr><?php endif; ?>
</table></div>
