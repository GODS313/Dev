# DEPLOYMENT — استقرار روی Cloudflare Pages برای adlisho.online

Production branch: `main`

Framework preset: Static Site (no framework) یا انتخاب "Other" / "None" در Cloudflare Pages

Build command:
- اگر پروژه نیاز به build ندارد: هیچ
- اگر از ابزارهای frontend استفاده کنید (مثلا npm run build): دستور دقیق را اینجا قرار دهید (مثال: `npm ci && npm run build`)

Build output directory:
- در حالت بدون Build: `/` (فایل `index.html` در ریشه)
- اگر build دارید: پوشهٔ خروجی مثلاً `dist/` یا `build/` — در این repo خروجی نهایی `index.html` در ریشه است.

Environment Variables موردنیاز (نمونه):
- CF_PAGES_BRANCH=main
- CF_ACCOUNT_ID (تنظیم در UI Cloudflare)
- D1_DATABASE (در صورت نیاز)
- KV_NAMESPACE (در صورت نیاز)
- BOT_WEBHOOK_SECRET (درصورتی‌که Webhook دارید)

D1/KV bindings:
- اگر به D1 یا KV نیاز دارید، در بخش "Functions" یا "Pages" آن‌ها را binding کنید. نام bindingها باید مطابق `DEPLOYMENT.md` و `config.json` باشد.

افزودن دامنه `adlisho.online`:
1. در داشبورد Cloudflare Pages پروژهٔ مورد نظر را باز کنید.
2. بخش "Custom domains" → "Add a custom domain" → وارد کنید `adlisho.online`.
3. از طریق Cloudflare، رکوردهای DNS را تنظیم کنید یا Cloudflare درخواست را دنبال کنید.
4. برای `www.adlisho.online` هم همین کار را انجام دهید و یک Redirect 301 از `www` به دامنهٔ اصلی تنظیم کنید (در Cloudflare Pages یا از طریق Rules: Forwarding URL => 301).
5. فعال‌سازی "Always Use HTTPS" در تنظیمات دامنه‌ی Cloudflare (SSL/TLS) ضروری است.

Redirect دائمی `www` به دامنه اصلی:
- اضافه کردن Page Rule یا استفاده از گزینهٔ Redirect در Cloudflare Pages: Forwarding URL (301) از `https://www.adlisho.online/*` به `https://adlisho.online/$1`.

Rollback به Commit قبلی:
- در Cloudflare Pages → Deployments → سابقهٔ دیپلوی‌ها → انتخاب Commit قبلی → Redeploy (یا Rollback) به آن Commit.

ربات تلگرام و VPS (ملاحظات و مراحل):
- توکن ربات را فقط در Secrets ذخیره کنید (Cloudflare Pages Environment variables یا VPS env).
- اگر Webhook می‌خواهید، باید یک endpoint در VPS یا Cloudflare Workers داشته باشید؛ Pages Functions مناسب برای آزمون است اما برای Webhook همیشه بهتر است از یک سرور واقعی با TLS معتبر استفاده شود.
- مراحل روی VPS و BotFather را در بخش "Bot Deployment" این فایل درج کنید (زیر).

Bot Deployment (مهم — مستندات برای کار بر روی VPS):
1. ساخت ربات در BotFather و دریافت توکن (TOKEN را در `.env` یا Secrets قرار دهید).
2. در VPS یک سرویس تهیه کنید (مثلا systemd service) که وب‌سرور کوچک (مثلا Node.js/Express یا Flask) را اجرا کند و یک endpoint مثل `/webhook` داشته باشد.
3. در BotFather دستور `setwebhook` را با URL `https://adlisho.online/webhook` تنظیم کنید (اگر از path متفاوت استفاده می‌کنید، آن را در اینجا ذکر کنید).
4. حتماً HTTPS با یک گواهی معتبر (Cloudflare Tunnel یا TLS مستقیم) فراهم کنید.
5. در Cloudflare، Rules یا Firewall را طوری تنظیم کنید که درخواست‌های بات محدود شوند (Rate limit) و IPهای مشکوک بلاک شوند.

فشار نهایی و تست‌ها (Checklist):
- Build بدون خطا اجرا شود.
- `index.html` در خروجی موجود باشد.
- همهٔ صفحات داخلی از direct URL بارگذاری شوند (SPA routing configured via `_redirects`).
- APK link تست شود (HEAD request) و Content-Type `application/vnd.android.package-archive` یا redirect به چنین فایلی داشته باشد.

تذکرات امنیتی:
- هیچ توکن یا secret در ریپو نباشد.
- اطلاعات حساس فقط در Environment variables ذخیره شوند.

