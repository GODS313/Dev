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

تابع دانلود ابتدا `download_source` را از D1 می‌خواند و فقط برای مهاجرت کلید قدیمی `download_url` را قبول می‌کند. `APK_DOWNLOAD_URL` صرفاً fallback زمان نبودن رکورد D1 است. مقدار production اولیه `https://seskia.online/est/download` است.

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

## 6) استقرار بات‌ها و عامل sync

```bash
sudo bash deploy-hamkare-bots.sh
```

نصاب موارد زیر را دریافت می‌کند:

- توکن و گروه گزارش هر بستر
- شناسه عددی مدیران تلگرام و بله
- نام برند و URLها از env یا مقادیر پیش‌فرض امن

کاربر عادی فقط ثبت‌نام، دانلود، سایت، پیگیری، پشتیبانی، حریم خصوصی و راهنما را می‌بیند. پنل مدیریت بات فقط برای شناسه‌های `ADMIN_IDS` ساخته می‌شود، اما تعویض APK در بات استخدامی تلگرام غیرفعال است تا با webhook اصلی Seskia رقابت نکند. رفتار بات بله همان حالت قبلیِ بدون آپلود APK باقی می‌ماند.

پس از نصب، `/start` را یک‌بار با حساب مدیر و یک‌بار با حساب کاربر عادی تست کنید. در هیچ‌کدام نباید «تعویض فایل APK» یا rollback نمایش داده شود.

بعد از deploy شدن Functions و ثبت secrets، عامل production را نصب کنید:

```bash
curl -fsSLo /tmp/install-hamkare-admin-vps.sh https://raw.githubusercontent.com/GODS313/Dev/main/install-hamkare-admin-vps.sh && sudo bash /tmp/install-hamkare-admin-vps.sh
```

این نصب‌کننده دیگر `admin.php` نویسنده config نمی‌سازد. writer، sudoers و config محلی قدیمی را پس از بکاپ بازنشسته می‌کند، یک timer سی‌ثانیه‌ای می‌سازد و env تلگرام و بله را مستقل اعمال می‌کند. تغییر منبع APK در D1 مستقیماً روی `/download.php` اثر می‌گذارد و چون URL عمومی ربات‌ها ثابت است، موجب restart ربات‌ها نمی‌شود.

## 7) پنل مدیریت APK و گزارش تلگرام روی Seskia

```bash
sudo bash install-seskia-admin-panel.sh
```

آدرس پنل: `https://seskia.online/admin.php`

پنل فقط کلیدهای Telegram یعنی `bot_token`، `admin_chat_ids`، `chat_ids`، `apk_channel_ids` و `webhook_secret` را از فرم تغییر می‌دهد. نصاب یک‌بار `apk_signer_sha256` را از APK رسمی فعلی استخراج و pin می‌کند؛ تغییر آن فقط با دسترسی root ممکن است. مقدارهای ناشناخته حفظ می‌شوند و فایل‌های بله (`bale.php` و state/runtime بله) خوانده یا نوشته نمی‌شوند. توکن کامل هیچ‌وقت در HTML نمایش داده نمی‌شود.

اگر `/opt/hamkare-bots/telegram.env` موجود باشد، نصاب فقط چهار گزینه APK همان بات استخدامی تلگرام را غیرفعال و فقط `hamkare-telegram.service` را restart می‌کند. `bale.env` و `hamkare-bale.service` حتی خوانده نمی‌شوند.

از داخل پنل می‌توان توکن بات اختصاصی APK، آیدی مدیر آپلود، چت‌آیدی گزارش و کانال مجاز را تغییر داد؛ توکن با `getMe` کنترل و webhook موجود `/telegram.php` دوباره متصل می‌شود. آپلود مرورگر تا ۲۰۰ مگابایت و rollback نیز ساختار APK، امضای release، گواهی pinشده، SHA-256، بکاپ و لینک عمومی را کنترل می‌کنند.

نصاب handler دانلود فعلی را با بکاپ جایگزین می‌کند تا همان URL ثابت `/est/download` فایل را با نام `hamkare.apk`، هدر cache عمومی پنج‌دقیقه‌ای، ETag و Range برای ادامه دانلود ارائه کند. اگر route عمومی پس از reload این هدرها را ندهد، نصب خودکار rollback می‌شود.

## 8) Rollback

در Pages > Deployments یک deployment سالم قبلی را انتخاب و Rollback/Redeploy کنید.

برای rollback خود APK، از بخش «بازگردانی نسخه قبل» در پنل `admin.php` استفاده کنید؛ نسخه جاری نیز پیش از بازگردانی قابل‌بازیابی می‌ماند. برای rollback کامل نصب پنل، بکاپ `/var/backups/seskia-admin-panel-<timestamp>` ساخته می‌شود. برای rollback کامل سرویس‌های استخدامی، پوشه `/opt/hamkare-bots.backup-<timestamp>` نگهداری می‌شود؛ سپس `systemctl daemon-reload` و restart سرویس لازم را اجرا کنید.

بکاپ مهاجرت sync در `/var/backups/hamkare-admin-sync-<timestamp>` قرار می‌گیرد. برای بازگشت اضطراری، timer را متوقف کنید، envهای بکاپ را برگردانید و فقط سرویس مربوط را restart کنید. مسیر رسمی قدیمی دانلود در Cloudflare Pages با `_redirects` به gateway `/download` هدایت می‌شود.
