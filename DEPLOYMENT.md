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

migration دوم، `migrations/002_download_page_and_media.sql`، جدول‌های `site_content` (محتوای صفحهٔ دانلود) و `media_assets` (فهرست تصاویر آپلودشده) را می‌سازد؛ با همان دستور بالا روی همان دیتابیس اجرا کنید.

سپس یک R2 bucket بسازید و در Pages > Settings > Functions > R2 bindings آن را با نام binding دقیق `MEDIA` متصل کنید — لوگو، آیکون و اسکرین‌شات‌های آپلودی از پنل یا ربات مادر همین‌جا ذخیره می‌شوند.

## 3) Functions، پنل واحد و مسیرها

- `functions/api/register.js` → `POST /api/register`
- `functions/api/result.js` → `GET /api/result?code=...&last4=...`
- `functions/api/admin/config.js` → API پنل canonical در `/admin`
- `functions/api/admin/sync.js` → خواندن محافظت‌شده تنظیمات توسط VPS
- `functions/download.js` → `GET /download`
- `functions/api/admin/download-page.js` → `GET/PUT` محتوای صفحهٔ دانلود (X-Admin-Key)
- `functions/api/download-page.js` → `GET /api/download-page` — همان محتوا به‌صورت عمومی و بدون رمز (ربات‌های دانلود و ربات مادر از همین می‌خوانند)
- `functions/api/admin/media.js` → آپلود/فهرست/حذف تصویر در R2 (X-Admin-Key)
- `functions/media/[id].js` → `GET /media/<id>` تحویل عمومی تصویر
- `functions/api/admin/stats.js` → آمار ثبت‌نام برای داشبورد پنل
- `functions/dl.js` → `GET /dl` صفحهٔ تک‌باکسی دانلود، رندرشده از محتوای D1
- مسیر قدیمی `/download.php` با `_redirects` به `/download` هدایت می‌شود.

پنل production فقط در `https://adlisho.online/admin` ارائه می‌شود. `/admin.html` و `/admin.php` به آن redirect می‌شوند. سه secret اجباری `ADMIN_PASSWORD`، `CONFIG_ENCRYPTION_KEY` و `VPS_SYNC_KEY` را در Cloudflare encrypted secrets قرار دهید. `VPS_SYNC_KEY` باید یک مقدار تصادفی مستقل ۳۲ تا ۱۲۸ نویسه‌ای باشد و همان مقدار هنگام نصب sync agent روی VPS وارد شود.

قرارداد پاسخ production در `GET /api/admin/sync` از کلیدهای سطح اصلی `revision`، `canonical_download_url`، `download_source`، `telegram` و `bale` تشکیل می‌شود. مقدار هر بستر یا `null` است یا شیئی با کلیدهای دقیق `token` و `chat_id`؛ تغییر این نام‌ها باید هم‌زمان در Function، عامل VPS و این مستند انجام شود.

مسیر عمومی دانلود ثابت است: `https://adlisho.online/download`. پنل منبع پشت‌صحنه را روی فایل مستقیم VPS نگه می‌دارد؛ `/download` فایل را stream می‌کند و `/download.php` فقط برای سازگاری قدیمی به `/download` هدایت می‌شود.

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
5. `GET /download` باید APK فعال VPS را با نام `hamkare.apk` و MIME اندروید تحویل دهد و دکمه‌ها باید URL عمومی Adlisho را حفظ کنند.
6. `GET /download.php` باید در نهایت به همان URL redirect شود.
7. در D1 Console درج سطر در جدول `registrations` را تأیید کنید.

## 6) استقرار بات‌ها و عامل sync

```bash
sudo bash deploy-hamkare-bots.sh
```

نصاب موارد زیر را دریافت می‌کند:

- توکن و گروه گزارش هر بستر
- شناسه عددی مدیران تلگرام و بله
- نام برند و URLها از env یا مقادیر پیش‌فرض امن

کاربر عادی فقط ثبت‌نام، دانلود، سایت، پیگیری، پشتیبانی، حریم خصوصی و راهنما را می‌بیند. پنل مدیریت بات فقط برای شناسه‌های `ADMIN_IDS` ساخته می‌شود. تعویض APK در بله همیشه غیرفعال است و در تلگرام پس از اجرای فعال‌ساز مستقیم VPS در دسترس مدیر قرار می‌گیرد. دکمه دانلود تلگرام و بله هر دو `https://adlisho.online/download` را از `DOWNLOAD_URL` می‌گیرند.

پس از نصب، `/start` را یک‌بار با حساب مدیر و یک‌بار با حساب کاربر عادی تست کنید. در هیچ‌کدام نباید «تعویض فایل APK» یا rollback نمایش داده شود.

بعد از deploy شدن Functions و ثبت secrets، عامل production را نصب کنید:

```bash
curl -fsSLo /tmp/install-hamkare-admin-vps.sh https://raw.githubusercontent.com/GODS313/Dev/main/install-hamkare-admin-vps.sh && sudo bash /tmp/install-hamkare-admin-vps.sh
```

این نصب‌کننده writer، sudoers و config محلی قدیمی را پس از بکاپ بازنشسته می‌کند، یک timer سی‌ثانیه‌ای می‌سازد و env تلگرام و بله را مستقل اعمال می‌کند. مقدار `DOWNLOAD_URL` در هر دو env همیشه مسیر عمومی ثابت Adlisho است.

## 7) انتشار APK مستقیم از تلگرام

برای فعال‌کردن آپلود مستقیم مدیر تلگرام روی VPS، این فرمان را روی سرور اجرا کنید:

```bash
( workdir="$(mktemp -d)"; trap 'rm -rf -- "$workdir"' EXIT; git clone --depth 1 https://github.com/GODS313/Dev.git "$workdir/Dev" && sudo bash "$workdir/Dev/enable-hamkare-telegram-direct-apk.sh" )
```

فعال‌ساز از envها و فایل بات بکاپ می‌گیرد، دسترسی محدود لازم به `/var/www/adlisho` را برای سرویس تلگرام برقرار می‌کند، آپلود بله را خاموش نگه می‌دارد و هر دو سرویس را بررسی می‌کند. سپس مدیر عددی مجاز فایل را به‌شکل Document می‌فرستد. بات همان فایل را بدون بازکردن، تغییر یا بررسی امضا روی `/var/www/adlisho/app.apk` اتمیک جایگزین می‌کند؛ فقط اندازه انتقال و SHA-256 برای تطبیق بایت‌ها کنترل می‌شوند. موفقیت پس از تطبیق فایل `https://adlisho.online/download` اعلام می‌شود. در هر شکست، فایل سالم قبلی فعال می‌ماند یا از بکاپ بازگردانده می‌شود.

## 9) صفحهٔ دانلود، CMS تصویری و ربات‌های جدید

`https://adlisho.online/dl` صفحهٔ تک‌باکسی دانلود است؛ هر متن، رنگ، لوگو، آیکون و اسکرین‌شات آن از تب «صفحهٔ دانلود» در `/admin` یا از ربات مادر قابل تغییر است — بدون نیاز به deploy مجدد. هر ذخیره یک `download_page_revision` جدید در D1 می‌سازد.

نصب ربات‌های دانلود (بدون نیاز به ثبت‌نام، جدا از بات استخدامی موجود):

```bash
sudo bash deploy-hamkare-download-bot.sh
```

دو توکن جدا برای تلگرام و بله می‌خواهد (نه همان توکن‌های بات استخدامی). لینک هر دو ربات را پس از نصب در فیلدهای «لینک ربات دانلود تلگرام/بله» در تب صفحهٔ دانلود ثبت کنید تا روی `/dl` هم دکمه‌شان نمایش داده شود.

نصب ربات مادر (کنترل پشتیبان، فقط تلگرام):

```bash
sudo bash deploy-hamkare-master-bot.sh
```

این ربات مستقیم با D1 HTTP API و R2 (امضای دستی AWS SigV4، بدون هیچ وابستگی خارجی) صحبت می‌کند — نه با adlisho.online — و برای همین حتی اگر سایت از داخل ایران فیلتر یا در دسترس نباشد کار می‌کند. برای نصب به این مقادیر نیاز دارید: `CF_ACCOUNT_ID`، `CF_D1_DATABASE_ID`، یک `CF_API_TOKEN` با دسترسی `Account → D1 → Edit`، و اعتبارنامهٔ R2 (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` از Cloudflare Dashboard → R2 → Manage API Tokens، به‌همراه نام باکت). پس از نصب، از حساب یک مدیر مجاز در `MASTER_ADMIN_IDS`، پیام `/panel` را ارسال کنید.

## 10) Rollback

در Pages > Deployments یک deployment سالم قبلی را انتخاب و Rollback/Redeploy کنید.

برای rollback خود APK، مدیر تلگرام گزینه بازگردانی را تأیید می‌کند؛ نسخه پشتیبان دوباره اعتبارسنجی و به‌صورت اتمیک روی مسیر زنده VPS قرار می‌گیرد. برای rollback کامل سرویس‌ها، پوشه `/opt/hamkare-bots.backup-<timestamp>` نگهداری می‌شود؛ سپس `systemctl daemon-reload` و restart سرویس لازم را اجرا کنید.

بکاپ مهاجرت sync در `/var/backups/hamkare-admin-sync-<timestamp>` قرار می‌گیرد. برای بازگشت اضطراری، timer را متوقف کنید، envهای بکاپ را برگردانید و فقط سرویس مربوط را restart کنید. مسیر عمومی Adlisho ثابت می‌ماند و فایل زنده VPS منبع پشت‌صحنه است.
