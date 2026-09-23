<h1>گزارش رویدادها</h1>
<div class="table"><table>
<tr><th>زمان</th><th>کاربر</th><th>رویداد</th><th>جزئیات</th><th>IP</th></tr>
<?php foreach ($rows as $r): ?>
<tr><td><?= $e($local($r['created_at'])) ?></td><td><?= $e($r['actor']) ?></td><td><?= $e($r['action']) ?></td><td><?= $e($r['detail'] ?? '') ?></td><td dir="ltr"><?= $e($r['ip'] ?? '') ?></td></tr>
<?php endforeach; ?>
</table></div>
