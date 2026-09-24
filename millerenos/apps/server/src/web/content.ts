import type { Locale } from '../i18n/index.js';

/**
 * Public website copy. Every statement here must be true of the product today.
 * Do not add integrations, certifications, customer counts or testimonials that do not exist.
 */
export type PageId =
  'home' | 'features' | 'pricing' | 'integrations' | 'security' | 'about' | 'contact' | 'privacy' | 'terms' | 'acceptable-use' | 'status';

export const PAGES: { id: PageId; path: string; inSitemap: boolean; priority: string }[] = [
  { id: 'home', path: '', inSitemap: true, priority: '1.0' },
  { id: 'features', path: 'features', inSitemap: true, priority: '0.8' },
  { id: 'pricing', path: 'pricing', inSitemap: true, priority: '0.8' },
  { id: 'integrations', path: 'integrations', inSitemap: true, priority: '0.6' },
  { id: 'security', path: 'security', inSitemap: true, priority: '0.6' },
  { id: 'about', path: 'about', inSitemap: true, priority: '0.5' },
  { id: 'contact', path: 'contact', inSitemap: true, priority: '0.5' },
  { id: 'privacy', path: 'privacy', inSitemap: true, priority: '0.3' },
  { id: 'terms', path: 'terms', inSitemap: true, priority: '0.3' },
  { id: 'acceptable-use', path: 'acceptable-use', inSitemap: true, priority: '0.3' },
  { id: 'status', path: 'status', inSitemap: false, priority: '0.1' },
];

interface Section {
  h: string;
  p?: string[];
  list?: string[];
}
export interface PageCopy {
  title: string;
  description: string;
  h1: string;
  lead: string;
  sections: Section[];
}

type Copy = {
  nav: Record<'features' | 'pricing' | 'integrations' | 'security' | 'about' | 'contact', string>;
  footer: { legal: string; privacy: string; terms: string; aup: string; status: string; rights: string };
  cta: string;
  ctaNote: string;
  skip: string;
  langSwitch: string;
  breadcrumbHome: string;
  notFoundTitle: string;
  notFoundText: string;
  pricingPer: (days: number) => string;
  pricingLimits: (products: number, ai: number) => string;
  trialCard: { title: string; text: string };
  pages: Record<PageId, PageCopy>;
};

const en: Copy = {
  nav: { features: 'Features', pricing: 'Pricing', integrations: 'Integrations', security: 'Security', about: 'About', contact: 'Contact' },
  footer: { legal: 'Legal', privacy: 'Privacy', terms: 'Terms', aup: 'Acceptable use', status: 'Status', rights: 'All rights reserved.' },
  cta: 'Start free in Telegram',
  ctaNote: '1-hour free trial · no card required',
  skip: 'Skip to content',
  langSwitch: 'فارسی',
  breadcrumbHome: 'Home',
  notFoundTitle: 'Page not found',
  notFoundText: 'The page you are looking for does not exist or has moved.',
  pricingPer: (d) => `per ${d} days, paid with Telegram Stars`,
  pricingLimits: (p, a) => `Up to ${p} products · ${a} AI requests per day`,
  trialCard: { title: 'Free trial', text: 'One hour with real features: create your store, add products and try the AI assistant.' },
  pages: {
    home: {
      title: 'Millerenos — AI-powered commerce inside Telegram',
      description:
        'Create a store in Telegram, manage products and orders, and draft customer replies with an AI assistant grounded in your own catalog. Start with a 1-hour free trial.',
      h1: 'Run your business inside Telegram',
      lead: 'Millerenos gives small businesses a store, orders, customers and an AI sales assistant — right where their customers already chat.',
      sections: [
        {
          h: 'From zero to first order, fast',
          list: [
            'Start your trial in the Millerenos bot — no forms, no card.',
            'Add your first product in the Mini App.',
            'Publish your store and share one link with customers.',
            'Receive orders and get notified instantly in Telegram.',
          ],
        },
        {
          h: 'An AI assistant that sticks to your facts',
          p: [
            'Draft replies to customers and product descriptions using only your approved catalog, FAQ and policies. The assistant does not invent prices, stock or guarantees, and you decide how much automation to allow.',
          ],
        },
        {
          h: 'Built to be trusted',
          p: [
            'Each business gets an isolated workspace, enforced in the database itself. Payments for Millerenos plans use Telegram Stars, and we never store card data.',
          ],
        },
      ],
    },
    features: {
      title: 'Features — Millerenos',
      description: 'Telegram store, products, orders, customers, AI replies and a Mini App workspace. See what Millerenos does today.',
      h1: 'Features',
      lead: 'Everything below is available today. Upcoming work is listed separately and clearly marked.',
      sections: [
        {
          h: 'Store & catalog',
          list: [
            'Products and services with prices and optional stock tracking',
            'Categories',
            'Shareable Telegram store link',
            'Store details: tagline, delivery info, support contact',
          ],
        },
        {
          h: 'Orders & customers',
          list: [
            'Orders placed by customers inside Telegram',
            'Server-side pricing and stock checks',
            'Order status workflow: pending → confirmed → paid → fulfilled',
            'Customer list built from real orders',
            'Instant new-order notifications in the bot',
          ],
        },
        {
          h: 'AI assistant',
          list: [
            'Reply suggestions grounded in your catalog, FAQ and policies',
            'Product description drafts from your own notes',
            'Modes: manual, suggest-only, approval required',
            'Usage limits per plan and an audit log',
          ],
        },
        {
          h: 'Workspace',
          list: [
            'Telegram Mini App with light/dark themes',
            'English and Persian with right-to-left layout',
            'Activation checklist to reach your first sale',
            'Support tickets with reference numbers',
          ],
        },
        {
          h: 'Planned (not available yet)',
          list: [
            'Unified inbox across more messaging platforms',
            'Campaigns with consent management',
            'Web storefront',
            'Domains and hosting',
          ],
        },
      ],
    },
    pricing: {
      title: 'Pricing — Millerenos',
      description: 'Simple plans paid with Telegram Stars. Try every core feature free for one hour.',
      h1: 'Pricing',
      lead: 'Start with a one-hour free trial. When it ends your data is kept, and you can pick a plan any time.',
      sections: [
        {
          h: 'What happens when the trial ends?',
          p: ['Your store and data are kept. Creating new products, orders and AI requests pauses until you choose a plan.'],
        },
        {
          h: 'How do I pay?',
          p: ['Plans are digital services inside Telegram, so payment uses Telegram Stars through Telegram’s own checkout.'],
        },
      ],
    },
    integrations: {
      title: 'Integrations — Millerenos',
      description: 'Honest integration status for Millerenos: what is supported today and what is still being evaluated.',
      h1: 'Integrations',
      lead: 'We only list an integration as available when it uses an official, permitted method and works reliably.',
      sections: [],
    },
    security: {
      title: 'Security — Millerenos',
      description:
        'How Millerenos protects business and customer data: tenant isolation, encryption in transit, audit logs and responsible disclosure.',
      h1: 'Security at Millerenos',
      lead: 'This page describes controls that exist today. It will be updated as they evolve.',
      sections: [
        {
          h: 'Tenant isolation',
          p: [
            'Every business has its own workspace. Access is checked in the application and again by row-level security in the database.',
          ],
        },
        {
          h: 'Authentication',
          p: [
            'Sign-in to the Mini App uses Telegram’s signed launch data, verified on our servers. Sessions are random tokens stored only as hashes and expire automatically.',
          ],
        },
        {
          h: 'Payments',
          p: [
            'Plan payments use Telegram Stars. Millerenos never receives or stores card numbers. Each payment is recorded once, even if Telegram delivers it twice.',
          ],
        },
        {
          h: 'Operations',
          list: [
            'Encrypted transport (HTTPS) for all traffic',
            'Secrets kept out of source code and redacted from logs',
            'Audit log for administrative and sensitive actions',
            'Encrypted database backups with regular restore tests',
          ],
        },
        {
          h: 'Responsible disclosure',
          p: [
            'Found a vulnerability? Please report it through the contact address in /.well-known/security.txt. Do not access data that is not yours and give us reasonable time to fix the issue.',
          ],
        },
      ],
    },
    about: {
      title: 'About — Millerenos',
      description: 'Millerenos builds AI-powered commerce tools for small businesses, starting in Telegram.',
      h1: 'About Millerenos',
      lead: 'We help small businesses sell where their customers already are, with tools that are simple, fast and trustworthy.',
      sections: [
        {
          h: 'Our approach',
          list: [
            'Useful before impressive',
            'Honest about what exists',
            'Respect for platform rules and customer consent',
            'Privacy by default',
          ],
        },
      ],
    },
    contact: {
      title: 'Contact — Millerenos',
      description:
        'Get help with Millerenos: open a support ticket inside the Telegram bot and receive a reference number and replies in Telegram.',
      h1: 'Contact',
      lead: 'The fastest way to reach us is the Support section inside the Millerenos bot. Every request gets a reference number.',
      sections: [],
    },
    privacy: {
      title: 'Privacy policy — Millerenos',
      description: 'What data Millerenos collects, why, how long it is kept and how to export or delete it.',
      h1: 'Privacy policy',
      lead: 'Draft — pending legal review. Last updated 2026-09-24.',
      sections: [
        {
          h: 'Data we collect',
          list: [
            'Telegram account basics: numeric ID, first name, username, language',
            'Business data you add: store details, products, orders, FAQ',
            'Customer data created by orders in your store: Telegram ID and display name',
            'Usage events for product analytics (no message contents)',
            'Support tickets you create',
          ],
        },
        {
          h: 'Why we use it',
          list: [
            'To provide the service you asked for',
            'To secure accounts and prevent abuse (for example, one free trial per person)',
            'To improve the product using aggregated analytics',
          ],
        },
        {
          h: 'AI processing',
          p: [
            'When you use the AI assistant, the relevant catalog, FAQ, policies and the text you submit are sent to our AI provider to generate a draft. Outputs are stored in your workspace’s AI log.',
          ],
        },
        {
          h: 'Retention',
          p: [
            'Trial data is kept after the trial ends so you can continue. Deleted accounts are anonymized after a 14-day grace period; payment records are kept as required for accounting.',
          ],
        },
        {
          h: 'Your choices',
          p: ['You can export your personal data and request account deletion from Settings in the Mini App, or contact support.'],
        },
        {
          h: 'Service providers',
          list: [
            'Telegram (messaging, Mini App platform, Stars payments)',
            'AI provider (only when the AI assistant is used)',
            'Hosting and backup storage provider',
          ],
        },
      ],
    },
    terms: {
      title: 'Terms of service — Millerenos',
      description:
        'The terms for using Millerenos: the service, your responsibilities as a merchant, trials, paid plans and AI-generated drafts.',
      h1: 'Terms of service',
      lead: 'Draft — pending legal review. Last updated 2026-09-24.',
      sections: [
        {
          h: 'The service',
          p: ['Millerenos provides tools to run a store and serve customers in Telegram. Features may change as we improve the product.'],
        },
        {
          h: 'Your responsibilities',
          p: [
            'You are responsible for your products, prices, fulfilment and compliance with the laws that apply to your business, and for following our Acceptable Use Policy and Telegram’s terms.',
          ],
        },
        {
          h: 'Trial and plans',
          p: ['Each person may use one free trial. Paid plans renew only when you pay again; there is no automatic charge.'],
        },
        {
          h: 'AI output',
          p: ['AI drafts are suggestions. Review them before sending; you remain responsible for messages you send to customers.'],
        },
      ],
    },
    'acceptable-use': {
      title: 'Acceptable use policy — Millerenos',
      description:
        'What is not allowed on Millerenos, including spam, prohibited goods, fraud, fake reviews and attempts to bypass platform limits.',
      h1: 'Acceptable use policy',
      lead: 'To keep Millerenos safe for businesses and their customers, the following is not allowed:',
      sections: [
        {
          h: 'Not allowed',
          list: [
            'Unsolicited bulk messaging (spam) or messaging people who opted out',
            'Illegal, counterfeit or prohibited goods and services',
            'Fraud, phishing or collecting credentials',
            'Attempts to bypass platform limits, security or other businesses’ data isolation',
            'Fake reviews, fake scarcity or misleading claims',
          ],
        },
      ],
    },
    status: {
      title: 'Status — Millerenos',
      description: 'Current operational status of the Millerenos platform, checked live from our servers.',
      h1: 'System status',
      lead: 'Live checks from our servers.',
      sections: [],
    },
  },
};

const fa: Copy = {
  nav: { features: 'امکانات', pricing: 'قیمت‌ها', integrations: 'یکپارچه‌سازی‌ها', security: 'امنیت', about: 'درباره ما', contact: 'تماس' },
  footer: {
    legal: 'حقوقی',
    privacy: 'حریم خصوصی',
    terms: 'شرایط استفاده',
    aup: 'استفاده مجاز',
    status: 'وضعیت سرویس',
    rights: 'تمامی حقوق محفوظ است.',
  },
  cta: 'شروع رایگان در تلگرام',
  ctaNote: 'یک ساعت رایگان · بدون نیاز به کارت',
  skip: 'رفتن به محتوا',
  langSwitch: 'English',
  breadcrumbHome: 'خانه',
  notFoundTitle: 'صفحه پیدا نشد',
  notFoundText: 'صفحه‌ای که دنبال آن هستید وجود ندارد یا جابه‌جا شده است.',
  pricingPer: (d) => `برای ${d.toLocaleString('fa-IR')} روز، پرداخت با Telegram Stars`,
  pricingLimits: (p, a) => `تا ${p.toLocaleString('fa-IR')} محصول · ${a.toLocaleString('fa-IR')} درخواست هوش مصنوعی در روز`,
  trialCard: { title: 'دوره رایگان', text: 'یک ساعت با امکانات واقعی: فروشگاه بسازید، محصول اضافه کنید و دستیار هوشمند را امتحان کنید.' },
  pages: {
    home: {
      title: 'Millerenos — فروش هوشمند داخل تلگرام',
      description:
        'در تلگرام فروشگاه بسازید، محصولات و سفارش‌ها را مدیریت کنید و با دستیار هوشمندی که فقط به اطلاعات فروشگاه خودتان تکیه می‌کند به مشتری پاسخ دهید. با یک ساعت رایگان شروع کنید.',
      h1: 'کسب‌وکارتان را داخل تلگرام اداره کنید',
      lead: 'Millerenos به کسب‌وکارهای کوچک فروشگاه، سفارش، مدیریت مشتری و دستیار هوشمند فروش می‌دهد — همان جایی که مشتریانشان گفتگو می‌کنند.',
      sections: [
        {
          h: 'از صفر تا اولین سفارش، سریع',
          list: [
            'دوره رایگان را در ربات Millerenos شروع کنید — بدون فرم و بدون کارت.',
            'اولین محصول را در مینی‌اپ اضافه کنید.',
            'فروشگاه را منتشر کنید و یک لینک برای مشتریان بفرستید.',
            'سفارش بگیرید و فوراً در تلگرام باخبر شوید.',
          ],
        },
        {
          h: 'دستیار هوشمندی که به واقعیت‌های شما پایبند است',
          p: [
            'پاسخ به مشتری و توضیح محصول را فقط بر اساس کاتالوگ، پرسش‌های متداول و قوانین تأییدشده خودتان پیش‌نویس کنید. دستیار قیمت، موجودی یا ضمانت از خودش نمی‌سازد و میزان خودکارسازی را شما تعیین می‌کنید.',
          ],
        },
        {
          h: 'ساخته‌شده برای اعتماد',
          p: [
            'هر کسب‌وکار فضای کاری جداگانه‌ای دارد که جداسازی آن در خود پایگاه داده اعمال می‌شود. پرداخت پلن‌های Millerenos با Telegram Stars انجام می‌شود و ما هرگز اطلاعات کارت ذخیره نمی‌کنیم.',
          ],
        },
      ],
    },
    features: {
      title: 'امکانات — Millerenos',
      description: 'فروشگاه تلگرامی، محصولات، سفارش‌ها، مشتریان، پاسخ هوشمند و فضای کاری مینی‌اپ. امکانات امروز Millerenos را ببینید.',
      h1: 'امکانات',
      lead: 'همه موارد زیر همین امروز در دسترس است. برنامه‌های آینده جداگانه و با برچسب مشخص آمده‌اند.',
      sections: [
        {
          h: 'فروشگاه و کاتالوگ',
          list: [
            'محصول و خدمت با قیمت و کنترل اختیاری موجودی',
            'دسته‌بندی',
            'لینک قابل اشتراک فروشگاه در تلگرام',
            'اطلاعات فروشگاه: شعار، ارسال، راه تماس',
          ],
        },
        {
          h: 'سفارش‌ها و مشتریان',
          list: [
            'ثبت سفارش توسط مشتری داخل تلگرام',
            'محاسبه قیمت و موجودی در سرور',
            'مراحل سفارش: در انتظار ← تأییدشده ← پرداخت‌شده ← ارسال‌شده',
            'فهرست مشتریان بر اساس سفارش‌های واقعی',
            'اطلاع‌رسانی فوری سفارش جدید در ربات',
          ],
        },
        {
          h: 'دستیار هوشمند',
          list: [
            'پیشنهاد پاسخ بر اساس کاتالوگ، پرسش‌های متداول و قوانین شما',
            'پیش‌نویس توضیح محصول از یادداشت‌های خودتان',
            'حالت‌ها: دستی، فقط پیشنهاد، نیازمند تأیید',
            'سقف استفاده برای هر پلن و ثبت سوابق',
          ],
        },
        {
          h: 'فضای کاری',
          list: [
            'مینی‌اپ تلگرام با تم روشن و تیره',
            'فارسی و انگلیسی با چینش راست‌به‌چپ',
            'چک‌لیست راه‌اندازی تا اولین فروش',
            'تیکت پشتیبانی با کد پیگیری',
          ],
        },
        {
          h: 'در برنامه (هنوز در دسترس نیست)',
          list: ['صندوق پیام یکپارچه برای پیام‌رسان‌های بیشتر', 'کمپین با مدیریت رضایت مشتری', 'فروشگاه وب', 'دامنه و هاست'],
        },
      ],
    },
    pricing: {
      title: 'قیمت‌ها — Millerenos',
      description: 'پلن‌های ساده با پرداخت Telegram Stars. همه امکانات اصلی را یک ساعت رایگان امتحان کنید.',
      h1: 'قیمت‌ها',
      lead: 'با یک ساعت رایگان شروع کنید. پس از پایان آن اطلاعات شما حفظ می‌شود و هر زمان بخواهید می‌توانید پلن انتخاب کنید.',
      sections: [
        {
          h: 'پس از پایان دوره رایگان چه می‌شود؟',
          p: ['فروشگاه و اطلاعات شما حفظ می‌شود. ساخت محصول و سفارش جدید و استفاده از هوش مصنوعی تا انتخاب پلن متوقف می‌شود.'],
        },
        {
          h: 'چطور پرداخت کنم؟',
          p: ['پلن‌ها خدمت دیجیتال داخل تلگرام هستند، بنابراین پرداخت از طریق صفحه پرداخت خود تلگرام و با Telegram Stars انجام می‌شود.'],
        },
      ],
    },
    integrations: {
      title: 'یکپارچه‌سازی‌ها — Millerenos',
      description: 'وضعیت شفاف یکپارچه‌سازی‌های Millerenos: آنچه امروز پشتیبانی می‌شود و آنچه در حال بررسی است.',
      h1: 'یکپارچه‌سازی‌ها',
      lead: 'یک یکپارچه‌سازی را فقط زمانی «فعال» اعلام می‌کنیم که از روش رسمی و مجاز استفاده کند و پایدار کار کند.',
      sections: [],
    },
    security: {
      title: 'امنیت — Millerenos',
      description:
        'Millerenos چگونه از اطلاعات کسب‌وکارها و مشتریان محافظت می‌کند: جداسازی فضای کاری، رمزنگاری انتقال، ثبت سوابق و گزارش مسئولانه آسیب‌پذیری.',
      h1: 'امنیت در Millerenos',
      lead: 'این صفحه کنترل‌هایی را توضیح می‌دهد که امروز وجود دارند و با تغییر آن‌ها به‌روز می‌شود.',
      sections: [
        {
          h: 'جداسازی فضای کاری',
          p: ['هر کسب‌وکار فضای کاری مستقل دارد. دسترسی هم در برنامه و هم با امنیت سطح ردیف در پایگاه داده بررسی می‌شود.'],
        },
        {
          h: 'احراز هویت',
          p: [
            'ورود به مینی‌اپ با داده امضاشده تلگرام انجام و در سرور ما بررسی می‌شود. نشست‌ها توکن تصادفی هستند که فقط هش آن‌ها ذخیره می‌شود و خودکار منقضی می‌شوند.',
          ],
        },
        {
          h: 'پرداخت',
          p: [
            'پرداخت پلن‌ها با Telegram Stars است. Millerenos هیچ‌گاه شماره کارت دریافت یا ذخیره نمی‌کند. هر پرداخت فقط یک بار ثبت می‌شود، حتی اگر تلگرام آن را دو بار ارسال کند.',
          ],
        },
        {
          h: 'عملیات',
          list: [
            'انتقال رمزنگاری‌شده (HTTPS) برای همه ترافیک',
            'نگهداری اسرار خارج از کد و حذف آن‌ها از لاگ‌ها',
            'ثبت سوابق اقدامات مدیریتی و حساس',
            'پشتیبان‌گیری رمزنگاری‌شده با آزمون منظم بازیابی',
          ],
        },
        {
          h: 'گزارش مسئولانه آسیب‌پذیری',
          p: [
            'اگر آسیب‌پذیری پیدا کردید، از طریق نشانی موجود در /.well-known/security.txt گزارش دهید. به داده‌هایی که متعلق به شما نیست دسترسی نگیرید و زمان کافی برای رفع مشکل بدهید.',
          ],
        },
      ],
    },
    about: {
      title: 'درباره ما — Millerenos',
      description: 'Millerenos ابزارهای فروش هوشمند برای کسب‌وکارهای کوچک می‌سازد و از تلگرام شروع کرده است.',
      h1: 'درباره Millerenos',
      lead: 'به کسب‌وکارهای کوچک کمک می‌کنیم همان جایی بفروشند که مشتریانشان هستند؛ با ابزارهایی ساده، سریع و قابل اعتماد.',
      sections: [
        {
          h: 'رویکرد ما',
          list: [
            'مفید بودن پیش از پرزرق‌وبرق بودن',
            'صداقت درباره آنچه واقعاً وجود دارد',
            'احترام به قوانین پلتفرم‌ها و رضایت مشتری',
            'حریم خصوصی به‌صورت پیش‌فرض',
          ],
        },
      ],
    },
    contact: {
      title: 'تماس — Millerenos',
      description: 'دریافت کمک در Millerenos: داخل ربات تلگرام تیکت پشتیبانی ثبت کنید و کد پیگیری و پاسخ‌ها را در همان تلگرام دریافت کنید.',
      h1: 'تماس با ما',
      lead: 'سریع‌ترین راه، بخش پشتیبانی داخل ربات Millerenos است. هر درخواست کد پیگیری دارد.',
      sections: [],
    },
    privacy: {
      title: 'سیاست حریم خصوصی — Millerenos',
      description: 'Millerenos چه داده‌هایی جمع‌آوری می‌کند، چرا، تا چه زمانی نگه می‌دارد و چگونه می‌توانید آن را دریافت یا حذف کنید.',
      h1: 'سیاست حریم خصوصی',
      lead: 'پیش‌نویس — در انتظار بررسی حقوقی. آخرین به‌روزرسانی ۲۰۲۶-۰۹-۲۴.',
      sections: [
        {
          h: 'داده‌هایی که جمع‌آوری می‌کنیم',
          list: [
            'اطلاعات پایه حساب تلگرام: شناسه عددی، نام، نام کاربری، زبان',
            'داده‌های کسب‌وکار که وارد می‌کنید: اطلاعات فروشگاه، محصولات، سفارش‌ها، پرسش‌های متداول',
            'اطلاعات مشتری که با سفارش در فروشگاه شما ایجاد می‌شود: شناسه تلگرام و نام نمایشی',
            'رویدادهای استفاده برای تحلیل محصول (بدون متن پیام‌ها)',
            'تیکت‌های پشتیبانی',
          ],
        },
        {
          h: 'چرا از آن استفاده می‌کنیم',
          list: [
            'برای ارائه خدمتی که درخواست کرده‌اید',
            'برای امنیت حساب‌ها و جلوگیری از سوءاستفاده (مثلاً یک دوره رایگان برای هر نفر)',
            'برای بهبود محصول با تحلیل‌های تجمیعی',
          ],
        },
        {
          h: 'پردازش هوش مصنوعی',
          p: [
            'هنگام استفاده از دستیار هوشمند، کاتالوگ، پرسش‌های متداول، قوانین و متنی که ارسال می‌کنید برای تولید پیش‌نویس به ارائه‌دهنده هوش مصنوعی ما ارسال می‌شود. خروجی‌ها در سوابق هوش مصنوعی فضای کاری شما ذخیره می‌شوند.',
          ],
        },
        {
          h: 'مدت نگهداری',
          p: [
            'داده‌های دوره رایگان پس از پایان آن حفظ می‌شود تا بتوانید ادامه دهید. حساب‌های حذف‌شده پس از ۱۴ روز مهلت ناشناس می‌شوند؛ سوابق پرداخت طبق الزامات حسابداری نگهداری می‌شود.',
          ],
        },
        {
          h: 'اختیارات شما',
          p: ['می‌توانید از بخش تنظیمات مینی‌اپ داده‌های شخصی خود را دریافت کنید یا درخواست حذف حساب بدهید، یا با پشتیبانی تماس بگیرید.'],
        },
        {
          h: 'ارائه‌دهندگان خدمات',
          list: [
            'تلگرام (پیام‌رسانی، بستر مینی‌اپ، پرداخت Stars)',
            'ارائه‌دهنده هوش مصنوعی (فقط هنگام استفاده از دستیار)',
            'ارائه‌دهنده میزبانی و ذخیره‌سازی پشتیبان',
          ],
        },
      ],
    },
    terms: {
      title: 'شرایط استفاده — Millerenos',
      description:
        'شرایط استفاده از Millerenos: خدمت، مسئولیت‌های شما به‌عنوان فروشنده، دوره رایگان، پلن‌های پولی و پیش‌نویس‌های هوش مصنوعی.',
      h1: 'شرایط استفاده',
      lead: 'پیش‌نویس — در انتظار بررسی حقوقی. آخرین به‌روزرسانی ۲۰۲۶-۰۹-۲۴.',
      sections: [
        {
          h: 'خدمت',
          p: [
            'Millerenos ابزارهایی برای اداره فروشگاه و خدمت به مشتری در تلگرام ارائه می‌دهد. امکانات ممکن است در مسیر بهبود محصول تغییر کند.',
          ],
        },
        {
          h: 'مسئولیت‌های شما',
          p: [
            'مسئولیت محصولات، قیمت‌ها، ارسال و رعایت قوانین مربوط به کسب‌وکار شما و همچنین رعایت سیاست استفاده مجاز و قوانین تلگرام با شماست.',
          ],
        },
        {
          h: 'دوره رایگان و پلن‌ها',
          p: ['هر نفر می‌تواند یک بار از دوره رایگان استفاده کند. پلن‌ها فقط با پرداخت مجدد تمدید می‌شوند و برداشت خودکار وجود ندارد.'],
        },
        {
          h: 'خروجی هوش مصنوعی',
          p: ['پیش‌نویس‌های هوش مصنوعی پیشنهاد هستند. پیش از ارسال آن‌ها را بررسی کنید؛ مسئولیت پیام‌هایی که به مشتری می‌فرستید با شماست.'],
        },
      ],
    },
    'acceptable-use': {
      title: 'سیاست استفاده مجاز — Millerenos',
      description: 'موارد غیرمجاز در Millerenos از جمله اسپم، کالای ممنوع، کلاهبرداری، نظر جعلی و تلاش برای دور زدن محدودیت‌های پلتفرم.',
      h1: 'سیاست استفاده مجاز',
      lead: 'برای امن ماندن Millerenos برای کسب‌وکارها و مشتریانشان، موارد زیر مجاز نیست:',
      sections: [
        {
          h: 'غیرمجاز',
          list: [
            'ارسال انبوه پیام ناخواسته (اسپم) یا پیام به کسانی که انصراف داده‌اند',
            'کالا و خدمات غیرقانونی، تقلبی یا ممنوع',
            'کلاهبرداری، فیشینگ یا جمع‌آوری اطلاعات ورود',
            'تلاش برای دور زدن محدودیت‌های پلتفرم، امنیت یا جداسازی داده‌های دیگران',
            'نظر جعلی، کمیابی ساختگی یا ادعای گمراه‌کننده',
          ],
        },
      ],
    },
    status: {
      title: 'وضعیت سرویس — Millerenos',
      description: 'وضعیت فعلی سرویس‌های Millerenos که به‌صورت زنده از سرورهای ما بررسی می‌شود.',
      h1: 'وضعیت سرویس',
      lead: 'بررسی زنده از سرورهای ما.',
      sections: [],
    },
  },
};

export const COPY: Record<Locale, Copy> = { en, fa };
