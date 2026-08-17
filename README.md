# همکاره

نسخه وایت‌لیبل وب‌سایت و بات‌های همکاره برای استقرار مستقیم روی Cloudflare Pages و VPS.

## امکانات

- رابط فارسی RTL و کاملاً واکنش‌گرا
- فرم ثبت درخواست و ارزیابی اولیه
- تولید کد پیگیری امن و جلوگیری از ثبت تکراری
- پیگیری نتیجه با کد اختصاصی و چهار رقم آخر موبایل
- اتصال Cloudflare Pages Functions به D1
- برند، پشتیبانی، پیگیری و پیام‌رسان‌ها از تنظیمات مرکزی؛ لینک دانلود روی GitHub Release رسمی ثابت است
- اعتبارسنجی سمت کاربر و سرور، محدودسازی درخواست و خروجی امن
- منوی شیشه‌ای کامل برای تلگرام و بله
- جداسازی قطعی منوی کاربر و مدیر با allowlist شناسه عددی
- آمار و توقف ثبت‌نام در بات
- Release واقعی GitHub با asset وایت‌لیبل `hamkare.apk`
- لینک ثابت عمومی و QR قابل اسکن برای همان asset

## استقرار

شاخه Production برابر `main`، پوشه خروجی `/` و Build command خالی است. Binding دیتابیس D1 باید با نام `DB` در Cloudflare Pages تعریف شود و migration موجود در `migrations/001_create_registrations.sql` اجرا شود. جزئیات کامل در [DEPLOYMENT.md](DEPLOYMENT.md) قرار دارد.

## پنل production و منبع واحد تنظیمات

مسیر canonical مدیریت فقط `https://adlisho.online/admin` است و Cloudflare D1 منبع تنظیمات توکن و Chat ID تلگرام و بله است. لینک دانلود قابل ویرایش نیست و در پنل نیز فقط GitHub Release رسمی نمایش داده می‌شود. ذخیره‌های چندفیلدی با `D1 batch` همراه یک `config_revision` انجام می‌شوند؛ بنابراین revision ناقص یا ترکیبی منتشر نمی‌شود.

`GET /api/admin/sync` فقط با secret مستقل `VPS_SYNC_KEY` قابل خواندن است. عامل همگام‌سازی VPS هر ۳۰ ثانیه revision را دریافت، فایل env هر بستر را جداگانه و با `fsync + rename` جایگزین و فقط همان سرویسی را restart می‌کند که مقدارهایش واقعاً تغییر کرده‌اند. تغییر تلگرام به `bale.env` دست نمی‌زند و سرویس بله را restart نمی‌کند؛ تغییر صرفِ منبع APK نیز هیچ رباتی را restart نمی‌کند.

قرارداد production این endpoint شامل کلیدهای سطح اصلی `revision`، `canonical_download_url`، `download_source`، `telegram` و `bale` است. مقدار هر بستر یا `null` است یا فقط کلیدهای `token` و `chat_id` را دارد؛ عامل VPS نیز دقیقاً همین نام‌ها را مصرف می‌کند.

مسیر نهایی و یکتای دانلود `https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk` است. دکمه سایت، QR، ربات تلگرام، ربات بله، پنل و مسیرهای سازگاری `/download` و `/download.php` همگی به همین Release هدایت می‌شوند.

نصب عامل sync روی VPS:

```bash
curl -fsSLo /tmp/install-hamkare-admin-vps.sh https://raw.githubusercontent.com/GODS313/Dev/main/install-hamkare-admin-vps.sh && sudo bash /tmp/install-hamkare-admin-vps.sh
```

نصاب مقدار همان `VPS_SYNC_KEY` ثبت‌شده در Cloudflare را به‌صورت مخفی می‌پرسد، writer محلی قدیمی را پس از بکاپ بازنشسته می‌کند و `admin.php` قدیمی را با redirect دائمی به `/admin` جایگزین می‌کند.

## مدیریت APK

فایل APK فقط با نام دقیق `hamkare.apk` در GitHub Release پروژه `GODS313/Dev` منتشر می‌شود. لینک `releases/latest/download` بدون تغییر باقی می‌ماند و همیشه asset آخرین Release را ارائه می‌کند. تنظیمات ربات‌های استخدامی فقط از پنل production همکاره در `/admin` مدیریت می‌شوند و توکن‌ها تغییری نمی‌کنند.

workflow دائمی `.github/workflows/publish-hamkare-apk.yml` ورودی‌های `source_url` و `sha256` را می‌گیرد، فقط منبع HTTPS تأییدشده Seskia را قبول می‌کند و قبل از انتشار اندازه، ساختار ZIP/APK، Manifest، DEX، SHA-256 و تداوم گواهی امضای نسخه فعلی GitHub را بررسی می‌کند. Release ابتدا Draft است و فقط پس از آپلود asset با نام `hamkare.apk` به latest تبدیل می‌شود؛ تأیید ناموفق باعث حذف خودکار Release تازه و حفظ نسخه سالم قبلی می‌شود.

برای فعال‌کردن منوی آپلود فقط در بات تلگرام، یک fine-grained token مخصوص همین مخزن با دسترسی `Actions: Read and write` بسازید و دستور زیر را روی VPS اجرا کنید. توکن به‌شکل مخفی پرسیده و فقط در `telegram.env` با دسترسی محدود ذخیره می‌شود؛ `bale.env` تغییر نمی‌کند.

```bash
( workdir="$(mktemp -d)"; trap 'rm -rf -- "$workdir"' EXIT; git clone --depth 1 https://github.com/GODS313/Dev.git "$workdir/Dev" && sudo bash "$workdir/Dev/enable-hamkare-telegram-apk-release.sh" )
```

پس از فعال‌سازی، مدیر مجاز در بات تلگرام از «پنل مدیریت ← تعویض فایل APK» فایل را به‌شکل Document می‌فرستد. بات پس از اعتبارسنجی و بکاپ، workflow را با SHA-256 همان فایل اجرا و تا تطبیق دانلود عمومی GitHub صبر می‌کند. دکمه بله، تلگرام و سایت بدون تغییر لینک، نسخه جدید GitHub را دریافت می‌کنند.

نصب بات‌ها:

```bash
sudo bash deploy-hamkare-bots.sh
```

شناسه‌های مدیر، توکن‌ها و گروه‌های گزارش بات‌های استخدامی در زمان نصب دریافت می‌شوند و فقط در فایل‌های env با دسترسی `0600` روی VPS قرار می‌گیرند. هر دو فایل `telegram.env` و `bale.env` همان لینک ثابت GitHub Release را دریافت می‌کنند.

هیچ توکن، رمز یا کلید محرمانه‌ای داخل مخزن نگهداری نمی‌شود.
