<h1>داشبورد</h1>
<div class="stats">
  <div class="stat"><b><?= $stats['users'] ?></b><span>کاربر</span></div>
  <div class="stat"><b><?= $stats['subscribed'] ?></b><span>عضو فعال پیام‌رسان</span></div>
  <div class="stat"><b><?= $stats['devices'] ?></b><span>دستگاه</span></div>
  <div class="stat"><b><?= $stats['sessions'] ?></b><span>نشست فعال</span></div>
  <div class="stat"><b><?= $stats['connectors'] ?></b><span>کانکتور فعال</span></div>
  <div class="stat"><b><?= $stats['campaigns'] ?></b><span>کمپین در جریان</span></div>
  <div class="stat"><b><?= $stats['sent'] ?></b><span>پیام ارسال‌شده</span></div>
</div>
<section class="card">
  <h2>وضعیت پردازشگر پس‌زمینه</h2>
  <p>آخرین اجرا: <b><?= $e($local($stats['worker'])) ?></b></p>
  <p class="muted">پردازشگر هر دقیقه با Cron اجرا می‌شود. اگر Cron در دسترس نبود، این آدرس را در یک سرویس کران آنلاین ثبت کنید:</p>
  <code class="wrap"><?= $e($cronUrl) ?></code>
</section>
