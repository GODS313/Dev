# همکاره — وبسایت رسمی

این مخزن حاوی سورس بهینه شده و قابل استقرارِ پروژهٔ «همکاره» برای استقرار روی Cloudflare Pages با دامنهٔ production: https://adlisho.online است.

توضیح کوتاه:
- سایت به صورت استاتیک / Jamstack ساخته شده و برای میزبانی در Cloudflare Pages آماده است.
- هدف: نگهداری ظاهر و محتوای فارسی، فرم‌ها، آزمون، دانلود اپلیکیشن و پنل مدیریت مطابق درخواست محصول.

نوت‌ها و نکات مهم:
- هیچ توکن یا راز (secret) در این مخزن قرار نگرفته است؛ متغیرهای حساس در فایل `.env.example` نشان داده شده‌اند و باید در بخش Environment variables در Cloudflare Pages یا سایر سرویس‌ها قرار بگیرند.
- فایل فشردهٔ قدیمی `Zirex_Case_Download_Admin_Final_cPanel.zip` در ریپو موجود است؛ حذف این فایل نیاز به حذف از طریق وب یا git و دسترسی نوشتن دارد. در گزارش نهایی اشاره شده است.

فایل‌های در این مخزن:
- `index.html` — نقطهٔ ورودی نهایی سایت (HTML5، RTL)
- `config.json` — تنظیمات مرکزی شامل URL دانلود APK
- `_redirects` — برای روتینگ SPA در Cloudflare Pages
- `DEPLOYMENT.md` — دستورالعمل کامل استقرار روی Cloudflare Pages و مراحل مرتبط با ربات/VPS
- `.env.example` — نمونهٔ متغیرهای محیطی (بدون مقادیر محرمانه)
- `robots.txt`, `manifest.json` — متادیتا برای نمایش و SEO

Commit نهایی: "Deploy Hamkare on Cloudflare Pages for adlisho.online"
