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

## 3) Functions، پنل واحد و مسیرها

- `functions/api/register.js` → `POST /api/register`
- `functions/api/result.js` → `GET /api/result?code=...&last4=...`
- `functions/api/admin/config.js` → API پنل canonical در `/admin`
- `functions/api/admin/sync.js` → خواندن محافظت‌شده تنظیمات توسط VPS
- `functions/download.js` → `GET /download`
- مسیر قدیمی `/download.php` با `_redirects` به `/download` هدایت می‌شود.

پنل production فقط در `https://adlisho.online/admin` ارائه می‌شود. `/admin.html` و `/admin.php` به آن redirect می‌شوند. سه secret اجباری `ADMIN_PASSWORD`، `CONFIG_ENCRYPTION_KEY` و `VPS_SYNC_KEY` را در Cloudflare encrypted secrets قرار دهید. `VPS_SYNC_KEY` باید یک مقدار تصادفی مستقل ۳۲ تا ۱۲۸ نویسه‌ای باشد و همان مقدار هنگام نصب sync agent روی VPS وارد شود.

قرارداد پاسخ production در `GET /api/admin/sync` از کلیدهای سطح اصلی `revision`، `canonical_download_url`، `download_source`، `telegram` و `bale` تشکیل می‌شود. مقدار هر بستر یا `null` است یا شیئی با کلیدهای دقیق `token` و `chat_id`؛ تغییر این نام‌ها باید هم‌زمان در Function، عامل VPS و این مستند انجام شود.

مقصد دانلود در کد ثابت است: `https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk`. پنل اجازه ثبت مقصد دیگری را نمی‌دهد و مسیرهای سازگاری `/download` و `/download.php` با پاسخ 302 به همین Release هدایت می‌شوند.

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
5. `GET /download` باید به URL نهایی GitHub Release redirect شود.
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

کاربر عادی فقط ثبت‌نام، دانلود، سایت، پیگیری، پشتیبانی، حریم خصوصی و راهنما را می‌بیند. پنل مدیریت بات فقط برای شناسه‌های `ADMIN_IDS` ساخته می‌شود. تعویض APK در بله همیشه غیرفعال است و در تلگرام نیز تا زمان اجرای فعال‌ساز امن GitHub غیرفعال می‌ماند. دکمه دانلود تلگرام و بله هر دو URL نهایی GitHub Release را از `DOWNLOAD_URL` می‌گیرند.

پس از نصب، `/start` را یک‌بار با حساب مدیر و یک‌بار با حساب کاربر عادی تست کنید. در هیچ‌کدام نباید «تعویض فایل APK» یا rollback نمایش داده شود.

بعد از deploy شدن Functions و ثبت secrets، عامل production را نصب کنید:

```bash
curl -fsSLo /tmp/install-hamkare-admin-vps.sh https://raw.githubusercontent.com/GODS313/Dev/main/install-hamkare-admin-vps.sh && sudo bash /tmp/install-hamkare-admin-vps.sh
```

این نصب‌کننده writer، sudoers و config محلی قدیمی را پس از بکاپ بازنشسته می‌کند، یک timer سی‌ثانیه‌ای می‌سازد و env تلگرام و بله را مستقل اعمال می‌کند. مقدار `DOWNLOAD_URL` در هر دو env همیشه URL نهایی GitHub Release است.

## 7) انتشار APK

workflow دائمی `.github/workflows/publish-hamkare-apk.yml` انتشار را انجام می‌دهد. ورودی‌ها `source_url` و `sha256` هستند؛ URL باید دقیقاً مسیر `https://seskia.online/download.php?src=github-release&sha256=<SHA256>` باشد. workflow اندازه حداکثر ۲۰ MB، ساختار ZIP، `AndroidManifest.xml`، `classes.dex`، سلامت آرشیو، امضای دیجیتال، رد کلید تست Android، تطبیق signer با Release فعلی و SHA-256 را قبل از ایجاد Release بررسی می‌کند.

برای اتصال آپلود تلگرام، یک fine-grained token محدود به مخزن `GODS313/Dev` با `Actions: Read and write` بسازید و روی VPS اجرا کنید:

```bash
( workdir="$(mktemp -d)"; trap 'rm -rf -- "$workdir"' EXIT; git clone --depth 1 https://github.com/GODS313/Dev.git "$workdir/Dev" && sudo bash "$workdir/Dev/enable-hamkare-telegram-apk-release.sh" )
```

فعال‌ساز فقط `telegram.env` و override سرویس `hamkare-telegram.service` را تغییر می‌دهد، از هر دو بکاپ می‌گیرد و `bale.env` یا سرویس بله را تغییر نمی‌دهد. سپس مدیر عددی مجاز از منوی «تعویض فایل APK» فایل را به‌شکل Document ارسال می‌کند. بات فایل را در staging هم‌فایل‌سیستم قرار می‌دهد، SHA-256 را به workflow می‌فرستد و فقط پس از تطبیق دانلود public GitHub پیام موفقیت می‌دهد. اگر dispatch، validation، Release یا تأیید نهایی شکست بخورد، آخرین APK عمومی سالم فعال می‌ماند و نسخه محلی نیز در صورت جایگزینی بازگردانده می‌شود.

## 8) Rollback

در Pages > Deployments یک deployment سالم قبلی را انتخاب و Rollback/Redeploy کنید.

برای rollback خود APK، مدیر تلگرام گزینه بازگردانی را تأیید می‌کند؛ همان نسخه پشتیبان دوباره اعتبارسنجی و از مسیر workflow به latest GitHub Release تبدیل می‌شود. Release تازه تا پیش از آپلود asset به‌صورت Draft می‌ماند و در صورت شکست تأیید نهایی خودکار حذف می‌شود. برای rollback کامل سرویس‌های استخدامی، پوشه `/opt/hamkare-bots.backup-<timestamp>` نگهداری می‌شود؛ سپس `systemctl daemon-reload` و restart سرویس لازم را اجرا کنید.

بکاپ مهاجرت sync در `/var/backups/hamkare-admin-sync-<timestamp>` قرار می‌گیرد. برای بازگشت اضطراری، timer را متوقف کنید، envهای بکاپ را برگردانید و فقط سرویس مربوط را restart کنید. مسیرهای قدیمی محلی صرفاً redirect سازگاری به GitHub Release هستند.
