# DEPLOYMENT — استقرار دقیق روی Cloudflare Pages برای adlisho.online

Production branch: `main`
Framework preset: None
Build command: (خالی)
Build output directory: `/`

1) پیکربندی پروژه در Cloudflare Pages
- در داشبورد Cloudflare → Pages → Create project یا انتخاب پروژه موجود.
- Repository: GODS313/Dev
- Production branch: `main`
- Framework preset: None
- Build command: (خالی)
- Build output directory: `/`

2) Environment variables (در بخش Settings > Environment variables قرار دهید)
- CF_PAGES_BRANCH=main
- CF_ACCOUNT_ID= (از داشبورد Cloudflare دریافت کنید)
- D1 binding (در بخش "Functions > D1") نام binding را `DB` قرار دهید.
- اگر از KV نیز استفاده کنید: نام binding را مطابق DEPLOYMENT قرار دهید.

3) D1 — Migration و Binding
- این پروژه شامل یک فایل migration SQL در `migrations/001_create_registrations.sql` که جدول `registrations` را ایجاد می‌کند.
- مراحل برای ایجاد D1 و اعمال migration:
  a) در Cloudflare dashboard → D1 → Create database → نام دلخواه.
  b) ایجاد binding در پروژه Pages: Settings → Functions → D1 bindings → Add binding
     - Name: `DB`
     - Database: انتخاب دیتابیس ساخته‌شده
  c) اعمال migration: از CLI wrangler یا از کنسول D1 در داشبورد استفاده کنید:
     - با wrangler:
       1. نصب wrangler (اگر ندارید): `npm install -g wrangler`
       2. در ریشهٔ پروژه، فایل migration موجود است. برای اعمال migration از دستورهای D1/Cloudflare استفاده کنید.
       3. مثال (با توجه به مستندات فعلی Cloudflare D1): `wrangler d1 migrations apply --project-name=<YOUR_PROJECT> --binding=DB`
     - یا از UI D1: وارد بخش Migrations شوید و SQL موجود در `migrations/001_create_registrations.sql` را اجرا کنید.

4) Files/Functions
- Pages Functions در مسیر `functions/api/` قرار دارند:
  - `functions/api/register.js` => POST /api/register
  - `functions/api/result.js` => GET /api/result?code=...
- Binding مورد نیاز در Functions: `DB` برای دسترسی به D1.

5) Custom domains
- افزودن دامنه `adlisho.online` در بخش Custom domains پروژهٔ Pages.
- افزودن `www.adlisho.online` نیز.
- تنظیم Redirect دائمی (301) از `www` به دامنهٔ اصلی:
  - Pages => Custom domains => انتخاب دامنه `www.adlisho.online` => Redirect to adlisho.online
  - یا از Cloudflare dashboard => Rules => Forwarding URL (301) from `https://www.adlisho.online/*` to `https://adlisho.online/$1`.

6) HTTPS و تنظیمات امنیت
- در Cloudflare → SSL/TLS: فعال‌سازی "Always Use HTTPS".
- در Pages → Settings: اطمینان حاصل کنید که HTTPS فعال است.

7) Rollback
- Cloudflare Pages → Deployments → انتخاب Deploy قبلی → Redeploy (یا Rollback) به Commit مورد نظر.

8) نکات عملیاتی و bindings
- Binding name for D1 must be `DB` to match the code in `functions/api/*.js`.
- Store any bot tokens or secrets in Pages environment variables (not in repo).

9) تست‌ها پس از استقرار
- اجرای Build بدون خطا (در preset None و no build command، Pages باید فایل‌های استاتیک را مستقیم منتشر کند).
- دسترسی به `https://adlisho.online` و بررسی صفحات: `index.html`, `privacy.html`, `terms.html`, `contact.html`.
- درخواست POST به `https://adlisho.online/api/register` برای ثبت‌نام و دریافت JSON پاسخ.
- بررسی دیتابیس D1 و جدول `registrations` برای سطرهای درج‌شده.

