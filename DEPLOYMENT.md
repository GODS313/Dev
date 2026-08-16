# DEPLOYMENT — استقرار دقیق روی Cloudflare Pages برای adlisho.online

Production branch: `main`
Framework preset: None
Build command: (خالی)
Build output directory: `/`

## 1) پیکربندی Pages

- Repository: `GODS313/Dev`
- Production branch: `main`
- Framework preset: None
- Build command: خالی
- Build output directory: `/`

## 2) D1 و binding

1. در Cloudflare Dashboard یک D1 database بسازید.
2. در Pages > Settings > Functions > D1 bindings، دیتابیس را با نام binding دقیق `DB` متصل کنید.
3. migration موجود در `migrations/001_create_registrations.sql` را روی دیتابیس production اجرا کنید:

```bash
npx wrangler@latest d1 migrations apply <D1_DATABASE_NAME> --remote
```

به‌جای `<D1_DATABASE_NAME>` نام واقعی دیتابیس D1 را قرار دهید. پس از اجرا، وجود جدول `registrations` را در D1 Console بررسی کنید.

## 3) Functions و مسیرها

- `functions/api/register.js` → `POST /api/register`
- `functions/api/result.js` → `GET /api/result?code=...&last4=...`
- `functions/download.js` → `GET /download`
- مسیر قدیمی `/download.php` با `_redirects` به `/download` هدایت می‌شود.

متغیر اختیاری `APK_DOWNLOAD_URL` باید یک URL کامل HTTPS برای APK باشد. مقدار production فعلی `https://seskia.online/est/download` است و در صورت تنظیم‌نشدن متغیر، gateway همین مقصد را استفاده می‌کند. توکن و secret را فقط در Cloudflare environment variables قرار دهید.

برای وایت‌لیبل‌های دیگر، `PUBLIC_ORIGINS` را با دامنه‌های HTTPS مجاز و `APK_ALLOWED_HOSTS` را با hostnameهای مجاز upstream تنظیم کنید. gateway مقصدهای خارج از allowlist را رد می‌کند و فایل را حداکثر پنج دقیقه روی لبه Cloudflare cache می‌کند.

## 4) دامنه و HTTPS

- `adlisho.online` و در صورت نیاز `www.adlisho.online` را در Custom domains متصل کنید.
- DNS دامنه باید به پروژه Pages متصل شود؛ رکورد قبلی VPS نباید هم‌زمان ترافیک production را نگه دارد.
- در SSL/TLS، گزینه Always Use HTTPS را فعال کنید.
- برای `www` یک redirect دائمی به دامنه اصلی تعریف کنید.

## 5) تست پس از Deploy

1. `GET /config.json` باید JSON معتبر و یک `apk_url` کامل با پروتکل HTTPS برگرداند.
2. `POST /api/register` با JSON معتبر باید `201` و کد پیگیری برگرداند.
3. ثبت دوباره همان موبایل باید `200` برگرداند، اما برای جلوگیری از افشای اطلاعات نباید کد پیگیری قبلی را نمایش دهد؛ بازیابی از مسیر پشتیبانی انجام می‌شود.
4. `GET /api/result?code=<CODE>&last4=<LAST4>` باید نتیجه را برگرداند.
5. `GET /download` باید پاسخ APK با `Content-Disposition: attachment; filename="hamkare.apk"` بدهد.
6. `GET /download.php` باید به `/download` redirect شود.
7. در D1 Console درج سطر در جدول `registrations` را تأیید کنید.

## 6) استقرار بات‌های تلگرام و بله

```bash
sudo bash deploy-hamkare-bots.sh
```

نصاب موارد زیر را دریافت می‌کند:

- توکن و گروه گزارش هر بستر
- شناسه عددی مدیران تلگرام و بله
- نام برند و URLها از env یا مقادیر پیش‌فرض امن
- مسیر واقعی APK در `APK_DEPLOY_PATH` (فایل `.apk` زیر `/var/www` یا `/srv`)

کاربر عادی فقط ثبت‌نام، دانلود، سایت، پیگیری، پشتیبانی، حریم خصوصی و راهنما را می‌بیند. پنل مدیریت فقط برای شناسه‌های `ADMIN_IDS` ساخته می‌شود. تعویض و rollback فایل APK فقط در تلگرام و فقط برای مدیر مجاز است؛ بله هیچ دسترسی آپلودی ندارد. `apksigner`، MIME/اندازه واقعی، ساختار ZIP، checksum، قفل تک‌نویسنده، staging هم‌فایل‌سیستم و تطبیق لینک عمومی پس از انتشار بررسی می‌شوند. نبود `apksigner`، امضای نامعتبر و کلید عمومی تست AOSP همگی باعث رد فایل می‌شوند؛ نسخه بازار باید با keystore اختصاصی release امضا شده باشد. اگر SHA-256 لینک عمومی با فایل تازه تطبیق نکند، انتشار ناموفق محسوب و نسخه قبلی به‌صورت اتمیک بازگردانده می‌شود.

پس از نصب، `/start` را یک‌بار با حساب مدیر و یک‌بار با حساب کاربر عادی تست کنید. در حساب عادی نباید «پنل مدیریت»، «تعویض فایل APK» یا rollback نمایش داده شود. سپس یک APK امضاشده زیر ۲۰ مگابایت را با حساب مدیر بفرستید و تطبیق SHA-256 لینک `https://seskia.online/est/download` را در پیام موفقیت کنترل کنید.

## 7) Rollback

در Pages > Deployments یک deployment سالم قبلی را انتخاب و Rollback/Redeploy کنید.

برای rollback خود APK، مدیر `@Pasokh313e_bot` از دکمه «بازگردانی نسخه قبل» و تأیید دوم استفاده می‌کند؛ نسخه جاری نیز پیش از بازگردانی قابل‌بازیابی می‌ماند. برای rollback کامل سرویس‌ها، پوشه `/opt/hamkare-bots.backup-<timestamp>` یا مسیر اعلام‌شده توسط نصاب نگهداری می‌شود؛ سپس `systemctl daemon-reload` و restart هر دو سرویس را اجرا کنید.

اسکریپت قدیمی VPS پیش از کپی از کل web root بکاپ می‌گیرد و فایل PHP مدیریت‌نشده/قدیمی `download.php` را نگه نمی‌دارد. مسیر رسمی قدیمی در Cloudflare Pages با `_redirects` به gateway امن `/download` هدایت می‌شود.
