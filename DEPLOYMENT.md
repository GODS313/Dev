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

متغیر اختیاری `APK_DOWNLOAD_URL` باید یک URL کامل HTTPS برای APK باشد. اگر تنظیم نشود، gateway از URL پیش‌فرض HTTPS داخل Function استفاده می‌کند. توکن و secret را فقط در Cloudflare environment variables قرار دهید.

## 4) دامنه و HTTPS

- `adlisho.online` و در صورت نیاز `www.adlisho.online` را در Custom domains متصل کنید.
- DNS دامنه باید به پروژه Pages متصل شود؛ رکورد قبلی VPS نباید هم‌زمان ترافیک production را نگه دارد.
- در SSL/TLS، گزینه Always Use HTTPS را فعال کنید.
- برای `www` یک redirect دائمی به دامنه اصلی تعریف کنید.

## 5) تست پس از Deploy

1. `GET /config.json` باید JSON معتبر و `apk_url` برابر `/download` برگرداند.
2. `POST /api/register` با JSON معتبر باید `201` و کد پیگیری برگرداند.
3. ثبت دوباره همان موبایل باید `200` و همان کد را برگرداند.
4. `GET /api/result?code=<CODE>&last4=<LAST4>` باید نتیجه را برگرداند.
5. `GET /download` باید پاسخ APK با `Content-Disposition: attachment; filename="hamkare.apk"` بدهد.
6. `GET /download.php` باید به `/download` redirect شود.
7. در D1 Console درج سطر در جدول `registrations` را تأیید کنید.

## 6) Rollback

در Pages > Deployments یک deployment سالم قبلی را انتخاب و Rollback/Redeploy کنید.
